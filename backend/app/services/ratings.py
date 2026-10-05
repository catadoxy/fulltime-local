"""Automatic player ratings.

Elo-based, computed deterministically from every played match so the value is
always consistent with the recorded results (nothing to store or migrate).

* Everyone starts at ``BASE_ELO`` (1000).
* After each match: expected = 1 / (1 + 10 ** ((opp - me) / 400)),
  then elo += K * (actual - expected).
* ``K`` is larger while a player is provisional (few matches) so early results
  move the needle, then settles.
* A mild margin-of-victory multiplier rewards bigger wins.
* Penalty shoot-outs are treated as draws (the play was level).

The result is also mapped to the app's familiar 0-100 scale.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Game, Match, Player, Tournament

BASE_ELO = 1000.0
ELO_PER_RATING_POINT = 8.0


def _k_factor(played: int) -> float:
    if played < 10:
        return 40.0
    if played < 30:
        return 24.0
    return 16.0


def _to_rating(elo: float) -> int:
    rating = 50.0 + (elo - BASE_ELO) / ELO_PER_RATING_POINT
    return int(max(1, min(100, round(rating))))


def compute_ratings(db: Session) -> dict[int, dict]:
    """Return ``{player_id: {elo, rating, matches, won, drawn, lost}}``."""
    players = db.execute(select(Player)).scalars().all()
    state: dict[int, dict] = {
        p.id: {"elo": BASE_ELO, "matches": 0, "won": 0, "drawn": 0, "lost": 0}
        for p in players
    }

    # Build one chronological stream of results: tournament matches + friendlies.
    events: list[tuple] = []
    rows = db.execute(
        select(Match, Tournament)
        .join(Tournament, Match.tournament_id == Tournament.id)
        .where(
            Match.played.is_(True),
            Match.home_id.is_not(None),
            Match.away_id.is_not(None),
        )
    ).all()
    for m, t in rows:
        day = t.start_date or (t.created_at.date() if t.created_at else date.min)
        events.append(
            (
                (day, 1, t.id, m.round_number, m.match_number, m.id),
                m.home_id,
                m.away_id,
                m.home_score or 0,
                m.away_score or 0,
            )
        )
    for g in db.execute(select(Game)).scalars().all():
        events.append(
            ((g.played_at, 0, 0, 0, 0, g.id), g.home_id, g.away_id, g.home_score, g.away_score)
        )

    for _key, home_id, away_id, hs, as_ in sorted(events, key=lambda e: e[0]):
        a = state.get(home_id)
        b = state.get(away_id)
        if a is None or b is None or home_id == away_id:
            continue

        if hs > as_:
            s_home = 1.0
        elif hs < as_:
            s_home = 0.0
        else:
            s_home = 0.5  # includes shoot-outs

        expected_home = 1.0 / (1.0 + 10 ** ((b["elo"] - a["elo"]) / 400.0))
        multiplier = 1.0 + min(abs(hs - as_), 4) * 0.125

        a["elo"] += _k_factor(a["matches"]) * multiplier * (s_home - expected_home)
        b["elo"] += _k_factor(b["matches"]) * multiplier * ((1.0 - s_home) - (1.0 - expected_home))

        for side, score in ((a, s_home), (b, 1.0 - s_home)):
            side["matches"] += 1
            if score == 1.0:
                side["won"] += 1
            elif score == 0.0:
                side["lost"] += 1
            else:
                side["drawn"] += 1

    for pid, s in state.items():
        s["elo"] = int(round(s["elo"]))
        s["rating"] = _to_rating(s["elo"])
    return state


def rating_for(db: Session, player_id: int) -> dict:
    return compute_ratings(db).get(
        player_id,
        {"elo": int(BASE_ELO), "rating": 50, "matches": 0, "won": 0, "drawn": 0, "lost": 0},
    )
