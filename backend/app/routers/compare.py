from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Game, Match, Player, Tournament
from ..services.ratings import compute_ratings

router = APIRouter(prefix="/api/compare", tags=["compare"])


def _tally(rows: list[tuple[int, int]], pid: int) -> tuple[int, int, int, int, int, int]:
    played = won = drawn = lost = gf = ga = 0
    for f, a in rows:
        played += 1
        gf += f
        ga += a
        if f > a:
            won += 1
        elif f < a:
            lost += 1
        else:
            drawn += 1
    return played, won, drawn, lost, gf, ga


def _summary(
    db: Session,
    player: Player,
    t_ratings: dict,
    f_ratings: dict,
    *,
    t_rows: list | None = None,
    f_rows: list | None = None,
    titles: int = 0,
) -> dict:
    pid = player.id

    if t_rows is None:
        rows = db.execute(
            select(Match)
            .where(Match.played.is_(True), or_(Match.home_id == pid, Match.away_id == pid))
        ).scalars().all()
        t_rows = [
            ((m.home_score or 0, m.away_score or 0) if m.home_id == pid else (m.away_score or 0, m.home_score or 0))
            for m in rows
        ]
    if f_rows is None:
        grows = db.execute(select(Game).where(or_(Game.home_id == pid, Game.away_id == pid))).scalars().all()
        f_rows = [
            ((g.home_score, g.away_score) if g.home_id == pid else (g.away_score, g.home_score))
            for g in grows
        ]
        titles = db.execute(
            select(func.count()).select_from(Tournament).where(Tournament.champion_id == pid)
        ).scalar() or 0

    t_played, t_won, t_drawn, t_lost, t_gf, t_ga = _tally(t_rows, pid)
    f_played, f_won, f_drawn, f_lost, f_gf, f_ga = _tally(f_rows, pid)

    tr = t_ratings.get(pid, {"elo": 1000, "rating": 50})
    fr = f_ratings.get(pid, {"elo": 1000, "rating": 50})
    return {
        "player": {"id": pid, "name": player.name},
        "tournaments": {
            "elo": tr["elo"],
            "rating": tr["rating"],
            "played": t_played,
            "won": t_won,
            "drawn": t_drawn,
            "lost": t_lost,
            "goals_for": t_gf,
            "goals_against": t_ga,
            "titles": titles,
            "win_rate": round(100 * t_won / t_played) if t_played else 0,
        },
        "friendlies": {
            "elo": fr["elo"],
            "rating": fr["rating"],
            "played": f_played,
            "won": f_won,
            "drawn": f_drawn,
            "lost": f_lost,
            "goals_for": f_gf,
            "goals_against": f_ga,
            "win_rate": round(100 * f_won / f_played) if f_played else 0,
        },
    }


@router.get("")
def compare(a: int = Query(...), b: int = Query(...), db: Session = Depends(get_db)):
    if a == b:
        raise HTTPException(400, "Pick two different players")
    pa = db.get(Player, a)
    pb = db.get(Player, b)
    if not pa or not pb:
        raise HTTPException(404, "Player not found")

    t_ratings = compute_ratings(db, friendlies=False)
    f_ratings = compute_ratings(db, tournaments=False)

    # Batch career rows for both players (2 queries instead of 4).
    t_all = (
        db.execute(
            select(Match).where(
                Match.played.is_(True),
                or_(
                    Match.home_id.in_([a, b]),
                    Match.away_id.in_([a, b]),
                ),
            )
        )
        .scalars()
        .all()
    )
    f_all = (
        db.execute(
            select(Game).where(
                or_(Game.home_id.in_([a, b]), Game.away_id.in_([a, b]))
            )
        )
        .scalars()
        .all()
    )
    title_counts = dict(
        db.execute(
            select(Tournament.champion_id, func.count())
            .where(Tournament.champion_id.in_([a, b]))
            .group_by(Tournament.champion_id)
        ).all()
    )

    def rows_for(pid: int):
        t_rows = [
            (
                (m.home_score or 0, m.away_score or 0)
                if m.home_id == pid
                else (m.away_score or 0, m.home_score or 0)
            )
            for m in t_all
            if m.home_id == pid or m.away_id == pid
        ]
        f_rows = [
            ((g.home_score, g.away_score) if g.home_id == pid else (g.away_score, g.home_score))
            for g in f_all
            if g.home_id == pid or g.away_id == pid
        ]
        return t_rows, f_rows

    a_wins = b_wins = draws = a_goals = b_goals = 0
    matches: list[dict] = []

    def record(af: int, ag: int, date, competition: str, kind: str, note=None):
        nonlocal a_wins, b_wins, draws, a_goals, b_goals
        a_goals += af
        b_goals += ag
        if af > ag:
            a_wins += 1
        elif af < ag:
            b_wins += 1
        else:
            draws += 1
        matches.append(
            {
                "date": date,
                "competition": competition,
                "kind": kind,
                "a_score": af,
                "b_score": ag,
                "result": "A" if af > ag else "B" if af < ag else "D",
                "note": note,
            }
        )

    for m, t in db.execute(
        select(Match, Tournament)
        .join(Tournament, Match.tournament_id == Tournament.id)
        .where(
            Match.played.is_(True),
            or_(
                and_(Match.home_id == a, Match.away_id == b),
                and_(Match.home_id == b, Match.away_id == a),
            ),
        )
    ).all():
        a_home = m.home_id == a
        af, ag = (m.home_score or 0, m.away_score or 0) if a_home else (m.away_score or 0, m.home_score or 0)
        record(af, ag, t.start_date, t.name, "tournament")

    for g in db.execute(
        select(Game).where(
            or_(
                and_(Game.home_id == a, Game.away_id == b),
                and_(Game.home_id == b, Game.away_id == a),
            )
        )
    ).scalars().all():
        a_home = g.home_id == a
        af, ag = (g.home_score, g.away_score) if a_home else (g.away_score, g.home_score)
        record(af, ag, g.played_at, "Friendly", "friendly", g.note)

    matches.sort(key=lambda x: str(x["date"] or ""), reverse=True)

    a_t, a_f = rows_for(a)
    b_t, b_f = rows_for(b)
    return {
        "a": _summary(
            db, pa, t_ratings, f_ratings,
            t_rows=a_t, f_rows=a_f, titles=title_counts.get(a, 0),
        ),
        "b": _summary(
            db, pb, t_ratings, f_ratings,
            t_rows=b_t, f_rows=b_f, titles=title_counts.get(b, 0),
        ),
        "head_to_head": {
            "a_wins": a_wins,
            "b_wins": b_wins,
            "draws": draws,
            "a_goals": a_goals,
            "b_goals": b_goals,
            "played": len(matches),
            "matches": matches,
        },
    }
