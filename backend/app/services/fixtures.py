"""Tournament creation and fixture generation for every supported format."""
from __future__ import annotations

import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engine import knockout as ko
from ..engine import round_robin as rr
from ..engine import scheduling
from ..engine import swiss as swiss_engine
from ..models import Group, Match, Participant, Player, Tournament

KNOCKOUT_STAGES = {"r64", "r32", "r16", "qf", "sf", "third", "final"}
TABLE_STAGES = {"league", "league_phase", "group", "swiss"}


def default_settings(fmt: str) -> dict[str, Any]:
    base: dict[str, Any] = {"points_win": 3, "points_draw": 1, "points_loss": 0}
    if fmt == "league":
        return {**base, "double_round": False}
    if fmt == "knockout":
        return {"third_place": False}
    if fmt == "groups_knockout":
        return {**base, "nb_groups": 2, "qualifiers_per_group": 2, "double_round": False}
    if fmt == "swiss":
        return {**base, "rounds": None}
    if fmt == "champions_league":
        return {**base, "qualifiers": 8, "double_round": False}
    return base


# --------------------------------------------------------------------------- #
# Schedule helper
# --------------------------------------------------------------------------- #
def apply_schedule(matches: list[Match]) -> None:
    """Assign slot + pitch to a set of matches, grouping by round_number."""
    if not matches:
        return
    specs = [
        {"round_number": m.round_number, "home": m.home_id, "away": m.away_id} for m in matches
    ]
    assignment = scheduling.schedule(specs, _nb_pitches(matches))
    for i, m in enumerate(matches):
        slot, pitch = assignment[i]
        m.slot = slot
        m.pitch = pitch


def _nb_pitches(matches: list[Match]) -> int:
    # All matches belong to the same tournament.
    tour = matches[0].tournament
    return max(1, tour.nb_pitches if tour else 1)


# --------------------------------------------------------------------------- #
# Creation
# --------------------------------------------------------------------------- #
def create_tournament(db: Session, data) -> Tournament:
    player_ids = list(dict.fromkeys(data.player_ids))  # de-dupe, keep order
    if len(player_ids) < 2:
        raise ValueError("Select at least 2 players")

    players = db.execute(select(Player).where(Player.id.in_(player_ids))).scalars().all()
    if len(players) != len(player_ids):
        raise ValueError("One or more players do not exist")

    fmt = data.format
    settings = {**default_settings(fmt), **(data.settings or {})}

    tournament = Tournament(
        name=data.name,
        format=fmt,
        nb_pitches=data.nb_pitches,
        settings=settings,
        start_date=data.start_date,
    )
    db.add(tournament)
    db.flush()

    # Participants keep the given order as their seed.
    order = player_ids
    for i, pid in enumerate(order):
        db.add(Participant(tournament_id=tournament.id, player_id=pid, seed=i + 1))
    db.flush()

    if fmt == "league":
        _create_league(db, tournament, order)
    elif fmt == "knockout":
        _create_knockout(db, tournament, order)
    elif fmt == "groups_knockout":
        _create_groups_knockout(db, tournament, order)
    elif fmt == "champions_league":
        _create_champions_league(db, tournament, order)
    elif fmt == "swiss":
        _create_swiss(db, tournament, order)
    else:
        raise ValueError(f"Unknown format: {fmt}")

    db.commit()
    db.refresh(tournament)
    return tournament


def _new_match(tournament: Tournament, **kw) -> Match:
    return Match(tournament_id=tournament.id, **kw)


def _create_league(db: Session, t: Tournament, order: list[int]) -> None:
    rounds = rr.round_robin_double(order) if t.settings.get("double_round") else rr.round_robin(order)
    matches: list[Match] = []
    for ri, rnd in enumerate(rounds, start=1):
        for mi, (home, away) in enumerate(rnd):
            matches.append(
                _new_match(t, stage="league", round_number=ri, match_number=mi, home_id=home, away_id=away)
            )
    db.add_all(matches)
    db.flush()
    apply_schedule(matches)


def _create_knockout(db: Session, t: Tournament, order: list[int]) -> None:
    bracket = ko.build_bracket(order, third_place=bool(t.settings.get("third_place")))
    _persist_bracket(db, t, bracket)
    # Byes: a first-round match with exactly one participant auto-advances.

    from .results import advance_byes  # local import to avoid cycle

    advance_byes(db, t)


def _create_groups_knockout(db: Session, t: Tournament, order: list[int]) -> None:
    n_groups = max(1, int(t.settings.get("nb_groups", 2)))
    per_group = math.ceil(len(order) / n_groups)

    groups = []
    for g in range(n_groups):
        grp = Group(tournament_id=t.id, name=f"Group {chr(65 + g)}", sort_order=g)
        db.add(grp)
        groups.append(grp)
    db.flush()

    # Snake distribution keeps seeds balanced across groups.
    buckets: list[list[int]] = [[] for _ in range(n_groups)]
    for i, pid in enumerate(order):
        row, col = divmod(i, n_groups)
        g = col if row % 2 == 0 else n_groups - 1 - col
        buckets[g].append(pid)

    for gi, bucket in enumerate(buckets):
        for pid in bucket:
            part = db.execute(
                select(Participant).where(
                    Participant.tournament_id == t.id, Participant.player_id == pid
                )
            ).scalar_one()
            part.group_id = groups[gi].id
        rounds = (
            rr.round_robin_double(bucket)
            if t.settings.get("double_round")
            else rr.round_robin(bucket)
        )
        gmatches: list[Match] = []
        for ri, rnd in enumerate(rounds, start=1):
            for mi, (home, away) in enumerate(rnd):
                gmatches.append(
                    _new_match(
                        t,
                        stage="group",
                        group_id=groups[gi].id,
                        round_number=ri,
                        match_number=mi,
                        home_id=home,
                        away_id=away,
                    )
                )
        db.add_all(gmatches)
        db.flush()
        apply_schedule(gmatches)

    qualifiers = n_groups * int(t.settings.get("qualifiers_per_group", 2))
    size = ko.bracket_size(max(2, qualifiers))
    t.settings = {**t.settings, "knockout_size": size, "knockout_seeded": False}
    _persist_bracket(db, t, ko.build_bracket([None] * size), quick_schedule=True)


def _create_champions_league(db: Session, t: Tournament, order: list[int]) -> None:
    rounds = rr.round_robin_double(order) if t.settings.get("double_round") else rr.round_robin(order)
    matches: list[Match] = []
    for ri, rnd in enumerate(rounds, start=1):
        for mi, (home, away) in enumerate(rnd):
            matches.append(
                _new_match(
                    t, stage="league_phase", round_number=ri, match_number=mi, home_id=home, away_id=away
                )
            )
    db.add_all(matches)
    db.flush()
    apply_schedule(matches)

    qualifiers = min(int(t.settings.get("qualifiers", 8)), len(order))
    size = ko.bracket_size(max(2, qualifiers))
    t.settings = {**t.settings, "qualifiers": qualifiers, "knockout_size": size, "knockout_seeded": False}
    _persist_bracket(db, t, ko.build_bracket([None] * size), quick_schedule=True)


def _create_swiss(db: Session, t: Tournament, order: list[int]) -> None:
    rounds = t.settings.get("rounds") or max(3, math.ceil(math.log2(max(2, len(order)))))
    t.settings = {**t.settings, "rounds": rounds, "current_round": 1}
    pairs = swiss_engine.first_round(order)
    matches = [
        _new_match(t, stage="swiss", round_number=1, match_number=mi, home_id=h, away_id=a)
        for mi, (h, a) in enumerate(pairs)
    ]
    db.add_all(matches)
    db.flush()
    apply_schedule(matches)


# --------------------------------------------------------------------------- #
# Bracket persistence
# --------------------------------------------------------------------------- #
def _persist_bracket(db: Session, t: Tournament, bracket: list[dict], quick_schedule: bool = False) -> None:
    """Insert bracket matches and wire winner -> next match links."""
    tmp_to_match: dict[str, Match] = {}
    created: list[Match] = []
    for spec in bracket:
        m = _new_match(
            t,
            stage=spec["stage"],
            round_number=spec["round_number"],
            match_number=spec["match_number"],
            home_id=spec["home"] if isinstance(spec["home"], int) else None,
            away_id=spec["away"] if isinstance(spec["away"], int) else None,
        )
        if spec.get("third_place"):
            m.note = "third_place"
        db.add(m)
        created.append(m)
        tmp_to_match[spec["tmp_id"]] = m
    db.flush()

    for spec in bracket:
        if spec.get("next_tmp"):
            m = tmp_to_match[spec["tmp_id"]]
            nxt = tmp_to_match[spec["next_tmp"]]
            m.next_match_id = nxt.id
            m.next_slot = spec["next_slot"]

    if not quick_schedule:
        # Schedule by bracket round (round_number already encodes it).
        playable = [m for m in created if m.home_id is not None or m.away_id is not None]
        apply_schedule(playable if playable else created)


# --------------------------------------------------------------------------- #
# On-demand generation (Swiss + knockout seeding from tables)
# --------------------------------------------------------------------------- #
def generate_next_swiss_round(db: Session, t: Tournament) -> list[Match]:
    from .standings import standings

    current = int(t.settings.get("current_round", 1))
    total = int(t.settings.get("rounds", current))
    if current >= total:
        return []

    table = standings(db, t, stage="swiss")
    played = db.execute(
        select(Match).where(Match.tournament_id == t.id, Match.stage == "swiss")
    ).scalars().all()
    played_pairs = {
        frozenset((m.home_id, m.away_id))
        for m in played
        if m.home_id is not None and m.away_id is not None
    }

    pairs = swiss_engine.pair_round(table, played_pairs)
    next_round = current + 1
    matches = [
        _new_match(t, stage="swiss", round_number=next_round, match_number=mi, home_id=h, away_id=a)
        for mi, (h, a) in enumerate(pairs)
    ]
    db.add_all(matches)
    db.flush()
    apply_schedule(matches)
    t.settings = {**t.settings, "current_round": next_round}
    return matches


def seed_knockout_from_tables(db: Session, t: Tournament) -> None:
    """Fill the placeholder knockout bracket from group / league-phase results."""
    from .standings import standings

    if t.settings.get("knockout_seeded"):
        return

    size = int(t.settings.get("knockout_size", 0))
    if size < 2:
        return

    qualified: list[int] = []

    if t.format == "groups_knockout":
        q = int(t.settings.get("qualifiers_per_group", 2))
        tables = []
        for grp in sorted(t.groups, key=lambda g: g.sort_order):
            tables.append(standings(db, t, group_id=grp.id))
        # Seed order: all 1st places, then all 2nd places, ...
        for rank in range(q):
            for table in tables:
                if rank < len(table):
                    qualified.append(table[rank]["player_id"])
    elif t.format == "champions_league":
        table = standings(db, t, stage="league_phase")
        qualified = [row["player_id"] for row in table]

    qualified = qualified[:size]
    if len(qualified) < 2:
        return

    _fill_first_round(db, t, qualified)
    t.settings = {**t.settings, "knockout_seeded": True}


def _fill_first_round(db: Session, t: Tournament, qualified: list[int]) -> None:
    order = ko.seed_order(len(qualified) if len(qualified) & (len(qualified) - 1) == 0 else ko.bracket_size(len(qualified)))
    # Stretch qualified list to bracket size with None.
    size = ko.bracket_size(len(qualified))
    order = ko.seed_order(size)
    padded = qualified + [None] * (size - len(qualified))

    first_round = (
        db.execute(
            select(Match)
            .where(
                Match.tournament_id == t.id,
                Match.round_number == 0,
                Match.stage.in_(KNOCKOUT_STAGES),
            )
            .order_by(Match.match_number)
        )
        .scalars()
        .all()
    )
    for k, m in enumerate(first_round):
        s1, s2 = order[2 * k], order[2 * k + 1]
        m.home_id = padded[s1 - 1]
        m.away_id = padded[s2 - 1]
    db.flush()

    from .results import advance_byes

    advance_byes(db, t)
