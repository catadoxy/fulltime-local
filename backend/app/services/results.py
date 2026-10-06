"""Result entry, knockout progression, and stage-completion triggers."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Match, Tournament

KNOCKOUT_STAGES = {"r64", "r32", "r16", "qf", "sf", "third", "final"}
TABLE_STAGES = {"league", "league_phase", "group", "swiss"}


def _knockout_matches(db: Session, t: Tournament) -> list[Match]:
    return (
        db.execute(
            select(Match).where(
                Match.tournament_id == t.id, Match.stage.in_(KNOCKOUT_STAGES)
            )
        )
        .scalars()
        .all()
    )


def propagate(db: Session, t: Tournament, m: Match, winner_id: int) -> None:
    if m.next_match_id:
        nxt = db.get(Match, m.next_match_id)
        if nxt is not None and not nxt.played:
            if m.next_slot == "home":
                nxt.home_id = winner_id
            else:
                nxt.away_id = winner_id
    db.flush()


def _complete_walkover(db: Session, t: Tournament, m: Match, winner_id: int) -> None:
    m.played = True
    m.winner_id = winner_id
    m.note = (m.note or "") + " (bye)"
    propagate(db, t, m, winner_id)


def advance_byes(db: Session, t: Tournament) -> None:
    """Auto-advance first-round byes repeatedly until stable."""
    kos = _knockout_matches(db, t)
    referenced = {m.next_match_id for m in kos if m.next_match_id}
    changed = True
    while changed:
        changed = False
        for m in _knockout_matches(db, t):
            if m.id in referenced or m.played:
                continue
            if m.home_id is not None and m.away_id is None:
                _complete_walkover(db, t, m, m.home_id)
                changed = True
            elif m.away_id is not None and m.home_id is None:
                _complete_walkover(db, t, m, m.away_id)
                changed = True
    db.flush()


def set_result(db: Session, m: Match, payload) -> Match:
    t = m.tournament
    m.home_score = payload.home_score
    m.away_score = payload.away_score
    m.home_pen = payload.home_pen
    m.away_pen = payload.away_pen

    if m.home_id is None or m.away_id is None:
        raise ValueError("Cannot record a result for a match with unassigned players")

    winner: int | None
    if m.home_score > m.away_score:
        winner = m.home_id
    elif m.away_score > m.home_score:
        winner = m.away_id
    else:
        winner = None
        if m.stage in KNOCKOUT_STAGES:
            if (
                payload.home_pen is None
                or payload.away_pen is None
                or payload.home_pen == payload.away_pen
            ):
                raise ValueError("Knockout match is level: penalty scores are required")
            winner = m.home_id if payload.home_pen > payload.away_pen else m.away_id

    m.played = True
    m.winner_id = winner
    if winner is not None:
        propagate(db, t, m, winner)

    db.flush()
    _post_process(db, t, m)
    db.commit()
    db.refresh(m)
    return m


def clear_result(db: Session, m: Match) -> Match:
    t = m.tournament
    old_winner = m.winner_id
    old_next_id = m.next_match_id
    old_slot = m.next_slot
    # Loser is needed to unwind auto-filled third-place matches (SF -> third
    # is not wired via next_match_id).
    old_loser: int | None = None
    if m.home_id is not None and m.away_id is not None and old_winner is not None:
        old_loser = m.home_id if old_winner == m.away_id else m.away_id

    if old_next_id and old_winner is not None:
        nxt = db.get(Match, old_next_id)
        if nxt is not None:
            fed_slot = (old_slot == "home" and nxt.home_id == old_winner) or (
                old_slot != "home" and nxt.away_id == old_winner
            )
            if fed_slot:
                if nxt.played:
                    # Recursively clears its own downstream.
                    clear_result(db, nxt)
                    nxt = db.get(Match, old_next_id)
                if nxt is not None and not nxt.played:
                    if old_slot == "home":
                        nxt.home_id = None
                    else:
                        nxt.away_id = None

    # Unwind auto-filled third-place match fed by semifinal losers.
    if m.stage == "sf" and old_loser is not None:
        third = (
            db.execute(
                select(Match).where(
                    Match.tournament_id == t.id, Match.stage == "third"
                )
            )
            .scalars()
            .all()
        )
        for tm in third:
            if tm.played:
                continue
            if tm.home_id == old_loser:
                tm.home_id = None
            if tm.away_id == old_loser:
                tm.away_id = None

    if m.stage == "final" and old_winner is not None and t.champion_id == old_winner:
        t.champion_id = None
        t.status = "active"
        t.end_date = None
    elif t.status == "completed":
        # Clearing any result re-opens the tournament.
        t.status = "active"
        t.end_date = None
    m.played = False
    m.home_score = None
    m.away_score = None
    m.home_pen = None
    m.away_pen = None
    m.winner_id = None
    db.flush()
    db.commit()
    db.refresh(m)
    return m


# --------------------------------------------------------------------------- #
# Stage completion triggers
# --------------------------------------------------------------------------- #
def _post_process(db: Session, t: Tournament, m: Match) -> None:
    _fill_third_place(db, t)
    _maybe_generate_swiss(db, t)
    _maybe_seed_knockout(db, t)

    if m.stage == "final" and m.winner_id is not None:
        t.champion_id = m.winner_id
        db.flush()

    _maybe_complete(db, t)

    # For table formats the champion is simply the final table leader, so
    # recompute it on every result change (e.g. after editing a score).
    if t.format in ("league", "swiss") and t.status == "completed":
        from .standings import standings

        table = standings(db, t)
        if table:
            t.champion_id = table[0]["player_id"]
        db.flush()


def _maybe_complete(db: Session, t: Tournament) -> None:
    """Mark a tournament completed once every match has been played."""
    if t.status == "completed":
        return
    if db.execute(select(Match.id).where(Match.tournament_id == t.id).limit(1)).first() is None:
        return  # no fixtures yet
    unplayed = db.execute(
        select(Match).where(Match.tournament_id == t.id, Match.played.is_(False)).limit(1)
    ).scalar_one_or_none()
    if unplayed is not None:
        return

    # League / Swiss have no final — the table leader is the champion.
    if t.champion_id is None and t.format in ("league", "swiss"):
        from .standings import standings

        table = standings(db, t)
        if table:
            t.champion_id = table[0]["player_id"]

    t.status = "completed"
    if t.end_date is None:
        t.end_date = date.today()
    db.flush()


def complete_finished_tournaments(db: Session) -> int:
    """Backfill: complete any active tournament whose matches are all played."""
    changed = 0
    tours = (
        db.execute(select(Tournament).where(Tournament.status != "completed"))
        .scalars()
        .all()
    )
    for t in tours:
        before = t.status
        _maybe_complete(db, t)
        if t.status != before:
            changed += 1
    db.commit()
    return changed


def reconcile_champions(db: Session) -> int:
    """Fix stale champions on completed league/Swiss tournaments we created.

    Imported tournaments keep the champion from their source, so they're skipped.
    """
    from .standings import standings

    changed = 0
    tours = (
        db.execute(
            select(Tournament).where(
                Tournament.format.in_(("league", "swiss")),
                Tournament.status == "completed",
            )
        )
        .scalars()
        .all()
    )
    for t in tours:
        if (t.settings or {}).get("imported"):
            continue
        table = standings(db, t)
        if table and t.champion_id != table[0]["player_id"]:
            t.champion_id = table[0]["player_id"]
            changed += 1
    db.commit()
    return changed


def close_tournament(db: Session, t: Tournament) -> Tournament:
    """Manually close a tournament: pick a champion if we can, then complete it."""
    if t.format in ("league", "swiss"):
        from .standings import standings

        table = standings(db, t)
        if table:
            t.champion_id = table[0]["player_id"]
    elif t.champion_id is None:
        final = db.execute(
            select(Match)
            .where(Match.tournament_id == t.id, Match.stage == "final")
            .scalars()
            .first()
        )
        if final is not None and final.winner_id is not None:
            t.champion_id = final.winner_id

    t.status = "completed"
    if t.end_date is None:
        t.end_date = date.today()
    db.commit()
    db.refresh(t)
    return t


def _fill_third_place(db: Session, t: Tournament) -> None:
    sfs = (
        db.execute(
            select(Match).where(Match.tournament_id == t.id, Match.stage == "sf")
        )
        .scalars()
        .all()
    )
    third = (
        db.execute(
            select(Match).where(Match.tournament_id == t.id, Match.stage == "third")
        )
        .scalars()
        .all()
    )
    if len(sfs) == 2 and all(s.played for s in sfs) and third:
        match = third[0]
        if not match.played and match.home_id is None and match.away_id is None:
            losers = []
            for s in sfs:
                losers.append(s.home_id if s.winner_id == s.away_id else s.away_id)
            match.home_id, match.away_id = losers[0], losers[1]
            db.flush()


def _maybe_generate_swiss(db: Session, t: Tournament) -> None:
    if t.format != "swiss":
        return
    from .fixtures import generate_next_swiss_round

    current = int(t.settings.get("current_round", 1))
    total = int(t.settings.get("rounds", current))
    if current >= total:
        return
    unplayed = (
        db.execute(
            select(Match).where(
                Match.tournament_id == t.id,
                Match.stage == "swiss",
                Match.round_number == current,
                Match.played.is_(False),
            )
        )
        .scalars()
        .all()
    )
    if not unplayed:
        generate_next_swiss_round(db, t)
        db.flush()


def _maybe_seed_knockout(db: Session, t: Tournament) -> None:
    if t.format not in ("groups_knockout", "champions_league"):
        return
    if t.settings.get("knockout_seeded"):
        return
    stage = "group" if t.format == "groups_knockout" else "league_phase"
    unplayed = (
        db.execute(
            select(Match).where(
                Match.tournament_id == t.id, Match.stage == stage, Match.played.is_(False)
            )
        )
        .scalars()
        .all()
    )
    if not unplayed:
        from .fixtures import seed_knockout_from_tables

        seed_knockout_from_tables(db, t)
        db.flush()
