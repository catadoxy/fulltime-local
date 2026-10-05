"""League / group / Swiss standings computed from played matches."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Match, Participant, Player, Tournament

TABLE_STAGES = {"league", "league_phase", "group", "swiss"}


def _points(settings: dict, won: int, drawn: int, lost: int) -> int:
    return (
        won * int(settings.get("points_win", 3))
        + drawn * int(settings.get("points_draw", 1))
        + lost * int(settings.get("points_loss", 0))
    )


def standings(
    db: Session,
    tournament: Tournament,
    *,
    group_id: int | None = None,
    stage: str | None = None,
) -> list[dict]:
    """Return a sorted list of standing rows for a table."""
    part_stmt = select(Participant).where(Participant.tournament_id == tournament.id)
    if group_id is not None:
        part_stmt = part_stmt.where(Participant.group_id == group_id)
    participants = db.execute(part_stmt).scalars().all()

    rows: dict[int, dict] = {}
    for p in participants:
        player = db.get(Player, p.player_id)
        rows[p.player_id] = {
            "player_id": p.player_id,
            "player_name": player.name if player else f"#{p.player_id}",
            "played": 0,
            "won": 0,
            "drawn": 0,
            "lost": 0,
            "goals_for": 0,
            "goals_against": 0,
            "goal_diff": 0,
            "points": 0,
        }

    stmt = select(Match).where(Match.tournament_id == tournament.id, Match.played.is_(True))
    if group_id is not None:
        stmt = stmt.where(Match.group_id == group_id)
    if stage is not None:
        stmt = stmt.where(Match.stage == stage)
    else:
        stmt = stmt.where(Match.stage.in_(TABLE_STAGES))

    for m in db.execute(stmt).scalars().all():
        if m.home_id is None or m.away_id is None:
            continue
        home = rows.get(m.home_id)
        away = rows.get(m.away_id)
        if home is None or away is None:
            continue
        hs, as_ = m.home_score or 0, m.away_score or 0
        home["played"] += 1
        away["played"] += 1
        home["goals_for"] += hs
        home["goals_against"] += as_
        away["goals_for"] += as_
        away["goals_against"] += hs
        if hs > as_:
            home["won"] += 1
            away["lost"] += 1
        elif hs < as_:
            away["won"] += 1
            home["lost"] += 1
        else:
            home["drawn"] += 1
            away["drawn"] += 1

    for row in rows.values():
        row["goal_diff"] = row["goals_for"] - row["goals_against"]
        row["points"] = _points(
            tournament.settings, row["won"], row["drawn"], row["lost"]
        )

    return sorted(
        rows.values(),
        key=lambda r: (-r["points"], -r["goal_diff"], -r["goals_for"], r["player_name"].lower()),
    )
