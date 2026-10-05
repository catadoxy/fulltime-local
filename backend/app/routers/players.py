from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Game, Match, Participant, Player, Tournament
from ..schemas import PlayerCreate, PlayerOut, PlayerUpdate
from ..services.ratings import compute_ratings
from ..services.standings import standings

router = APIRouter(prefix="/api/players", tags=["players"])


@router.get("", response_model=list[PlayerOut])
def list_players(db: Session = Depends(get_db)):
    players = db.execute(select(Player).order_by(Player.name)).scalars().all()
    ratings = compute_ratings(db)

    counts = dict(
        db.execute(
            select(Participant.player_id, func.count()).group_by(Participant.player_id)
        ).all()
    )
    titles = dict(
        db.execute(
            select(Tournament.champion_id, func.count())
            .where(Tournament.champion_id.is_not(None))
            .group_by(Tournament.champion_id)
        ).all()
    )

    return [
        {
            "id": p.id,
            "name": p.name,
            "email": p.email,
            "picture": p.picture,
            "rating": ratings.get(p.id, {}).get("rating", 50),
            "elo": ratings.get(p.id, {}).get("elo", 1000),
            "tournaments": counts.get(p.id, 0),
            "titles": titles.get(p.id, 0),
        }
        for p in players
    ]


@router.post("", response_model=PlayerOut, status_code=201)
def create_player(payload: PlayerCreate, db: Session = Depends(get_db)):
    exists = db.execute(select(Player).where(Player.name == payload.name)).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "A player with that name already exists")
    player = Player(**payload.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


@router.patch("/{player_id}", response_model=PlayerOut)
def update_player(player_id: int, payload: PlayerUpdate, db: Session = Depends(get_db)):
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(player, key, value)
    db.commit()
    db.refresh(player)
    return player


@router.delete("/{player_id}", status_code=204)
def delete_player(player_id: int, db: Session = Depends(get_db)):
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    used = db.execute(
        select(Participant).where(Participant.player_id == player_id).limit(1)
    ).scalar_one_or_none()
    if used:
        raise HTTPException(409, "Player is used in one or more tournaments")
    db.delete(player)
    db.commit()


@router.get("/{player_id}/stats")
def player_stats(player_id: int, db: Session = Depends(get_db)):
    """Career statistics for a player, split into tournaments and friendlies."""
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(404, "Player not found")

    rating = compute_ratings(db).get(player_id, {"elo": 1000, "rating": 50})

    parts = (
        db.execute(select(Participant).where(Participant.player_id == player_id))
        .scalars()
        .all()
    )

    t_totals = {
        "tournaments": 0,
        "played": 0,
        "won": 0,
        "drawn": 0,
        "lost": 0,
        "goals_for": 0,
        "goals_against": 0,
        "titles": 0,
    }
    history: list[dict] = []

    for p in parts:
        t = db.get(Tournament, p.tournament_id)
        if not t:
            continue
        matches = (
            db.execute(
                select(Match).where(
                    Match.tournament_id == t.id,
                    Match.played.is_(True),
                    or_(Match.home_id == player_id, Match.away_id == player_id),
                )
            )
            .scalars()
            .all()
        )

        played = won = drawn = lost = gf = ga = 0
        for m in matches:
            if m.home_id == player_id:
                f, a = m.home_score or 0, m.away_score or 0
            else:
                f, a = m.away_score or 0, m.home_score or 0
            played += 1
            gf += f
            ga += a
            if f > a:
                won += 1
            elif f < a:
                lost += 1
            else:
                drawn += 1

        champion = t.champion_id == player_id
        history.append(
            {
                "tournament_id": t.id,
                "name": t.name,
                "format": t.format,
                "status": t.status,
                "start_date": t.start_date,
                "played": played,
                "won": won,
                "drawn": drawn,
                "lost": lost,
                "goals_for": gf,
                "goals_against": ga,
                "champion": champion,
                "rank": _rank_in_tournament(db, t, player_id),
            }
        )

        t_totals["tournaments"] += 1
        t_totals["played"] += played
        t_totals["won"] += won
        t_totals["drawn"] += drawn
        t_totals["lost"] += lost
        t_totals["goals_for"] += gf
        t_totals["goals_against"] += ga
        t_totals["titles"] += 1 if champion else 0

    history.sort(key=lambda h: (str(h["start_date"] or ""), h["tournament_id"]), reverse=True)
    t_totals["win_rate"] = (
        round(100 * t_totals["won"] / t_totals["played"]) if t_totals["played"] else 0
    )

    # Standalone friendlies.
    games = (
        db.execute(select(Game).where(or_(Game.home_id == player_id, Game.away_id == player_id)))
        .scalars()
        .all()
    )
    f_totals = {"played": 0, "won": 0, "drawn": 0, "lost": 0, "goals_for": 0, "goals_against": 0}
    f_matches: list[dict] = []
    for g in games:
        home = g.home_id == player_id
        opponent = g.away if home else g.home
        f, a = (g.home_score, g.away_score) if home else (g.away_score, g.home_score)
        result = "W" if f > a else "L" if f < a else "D"
        f_totals["played"] += 1
        f_totals["goals_for"] += f
        f_totals["goals_against"] += a
        f_totals["won" if result == "W" else "lost" if result == "L" else "drawn"] += 1
        f_matches.append(
            {
                "id": g.id,
                "played_at": g.played_at,
                "opponent_id": opponent.id if opponent else None,
                "opponent_name": opponent.name if opponent else "—",
                "home": home,
                "goals_for": f,
                "goals_against": a,
                "result": result,
                "note": g.note,
            }
        )

    f_matches.sort(key=lambda m: (str(m["played_at"] or ""), m["id"]), reverse=True)
    f_totals["win_rate"] = (
        round(100 * f_totals["won"] / f_totals["played"]) if f_totals["played"] else 0
    )

    player_data = PlayerOut.model_validate(player).model_dump()
    player_data["rating"] = rating["rating"]
    player_data["elo"] = rating["elo"]

    return {
        "player": player_data,
        "rating": {"elo": rating["elo"], "rating": rating["rating"]},
        "tournaments": {"totals": t_totals, "history": history},
        "friendlies": {"totals": f_totals, "matches": f_matches},
    }


def _rank_in_tournament(db: Session, t: Tournament, player_id: int) -> int | None:
    """League-table rank, when the tournament has a single table."""
    stage = None
    if t.format == "league":
        stage = "league"
    elif t.format == "champions_league":
        stage = "league_phase"
    if stage is None:
        return None
    table = standings(db, t, stage=stage)
    for i, row in enumerate(table):
        if row["player_id"] == player_id:
            return i + 1
    return None
