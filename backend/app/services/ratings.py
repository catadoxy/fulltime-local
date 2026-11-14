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


def _event_stream(
    db: Session, *, tournaments: bool = True, friendlies: bool = True
) -> list[dict]:
    """Chronological list of every played match that affects ratings."""
    names = {p.id: p.name for p in db.execute(select(Player)).scalars().all()}
    events: list[dict] = []

    if tournaments:
        rows = db.execute(
            select(Match, Tournament)
            .join(Tournament, Match.tournament_id == Tournament.id)
            .where(
                Match.played.is_(True),
                Match.home_id.is_not(None),
                Match.away_id.is_not(None),
                # Ratings only move once an event is closed, so a running
                # tournament cannot change the odds of its own remaining
                # matches.
                Tournament.status == "completed",
            )
        ).all()
        for m, t in rows:
            day = t.start_date or (t.created_at.date() if t.created_at else date.min)
            events.append(
                {
                    "key": (day, 1, t.id, m.round_number or 0, m.match_number or 0, m.id),
                    "date": day,
                    "home_id": m.home_id,
                    "away_id": m.away_id,
                    "home_score": m.home_score or 0,
                    "away_score": m.away_score or 0,
                    "kind": "tournament",
                    "competition": t.name,
                    "tournament_id": t.id,
                    "names": names,
                }
            )

    if friendlies:
        for g in db.execute(select(Game)).scalars().all():
            day = g.played_at or date.min
            events.append(
                {
                    "key": (day, 0, 0, 0, 0, g.id),
                    "date": day,
                    "home_id": g.home_id,
                    "away_id": g.away_id,
                    "home_score": g.home_score,
                    "away_score": g.away_score,
                    "kind": "friendly",
                    "competition": "Friendly",
                    "tournament_id": None,
                    "names": names,
                }
            )

    events.sort(key=lambda e: e["key"])
    return events


def _apply(state: dict[int, dict], event: dict) -> float | None:
    """Update both players' Elo for one event; return home win score (1/0.5/0)."""
    a = state.get(event["home_id"])
    b = state.get(event["away_id"])
    if a is None or b is None or event["home_id"] == event["away_id"]:
        return None

    hs, as_ = event["home_score"], event["away_score"]
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

    return s_home


def _fresh_state(players) -> dict[int, dict]:
    return {
        p.id: {"elo": BASE_ELO, "matches": 0, "won": 0, "drawn": 0, "lost": 0}
        for p in players
    }


def compute_ratings(
    db: Session, *, tournaments: bool = True, friendlies: bool = True
) -> dict[int, dict]:
    """Return ``{player_id: {elo, rating, matches, won, drawn, lost}}``.

    Pass ``friendlies=False`` for a tournament-only Elo, or
    ``tournaments=False`` for a friendlies-only Elo.
    """
    players = db.execute(select(Player)).scalars().all()
    state = _fresh_state(players)

    for event in _event_stream(db, tournaments=tournaments, friendlies=friendlies):
        _apply(state, event)

    for _pid, s in state.items():
        s["elo"] = int(round(s["elo"]))
        s["rating"] = _to_rating(s["elo"])
    return state


def player_timeline(db: Session, player_id: int) -> dict[str, list[dict]]:
    """Per-match snapshots for one player, split by tournament / friendly.

    Both tracks replay the same way ``compute_ratings`` does, so the last point
    always matches the profile's current Elo. Goals are cumulative.
    """
    players = db.execute(select(Player)).scalars().all()
    out: dict[str, list[dict]] = {"tournaments": [], "friendlies": []}

    tracks = (
        ("tournaments", {"friendlies": False}),
        ("friendlies", {"tournaments": False}),
    )
    for label, kwargs in tracks:
        state = _fresh_state(players)
        cum_gf = cum_ga = 0
        index = 0
        for event in _event_stream(db, **kwargs):
            home = event["home_id"]
            away = event["away_id"]
            involves = player_id in (home, away)
            if not involves:
                _apply(state, event)
                continue

            s_home = _apply(state, event)
            if s_home is None:
                continue

            index += 1
            is_home = home == player_id
            gf = event["home_score"] if is_home else event["away_score"]
            ga = event["away_score"] if is_home else event["home_score"]
            cum_gf += gf
            cum_ga += ga
            me = state[player_id]
            opp_id = away if is_home else home
            result = "W" if gf > ga else "L" if gf < ga else "D"

            out[label].append(
                {
                    "match": index,
                    "date": None if event["date"] == date.min else str(event["date"]),
                    "elo": int(round(me["elo"])),
                    "rating": _to_rating(me["elo"]),
                    "goals_for": gf,
                    "goals_against": ga,
                    "cumulative_goals_for": cum_gf,
                    "cumulative_goals_against": cum_ga,
                    "result": result,
                    "opponent_id": opp_id,
                    "opponent_name": event["names"].get(opp_id, "—"),
                    "competition": event["competition"],
                    "tournament_id": event["tournament_id"],
                    "home": is_home,
                }
            )
    return out


def rating_for(db: Session, player_id: int) -> dict:
    return compute_ratings(db).get(
        player_id,
        {"elo": int(BASE_ELO), "rating": 50, "matches": 0, "won": 0, "drawn": 0, "lost": 0},
    )
