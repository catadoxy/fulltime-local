from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Game, Player
from ..schemas import GameCreate, GameOut

router = APIRouter(prefix="/api/games", tags=["games"])


def _out(g: Game) -> dict:
    return {
        "id": g.id,
        "played_at": g.played_at,
        "home_id": g.home_id,
        "away_id": g.away_id,
        "home_name": g.home.name if g.home else None,
        "away_name": g.away.name if g.away else None,
        "home_score": g.home_score,
        "away_score": g.away_score,
        "note": g.note,
    }


@router.get("", response_model=list[GameOut])
def list_games(db: Session = Depends(get_db), limit: int = 500, offset: int = 0):
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    games = (
        db.execute(
            select(Game)
            .order_by(Game.played_at.desc(), Game.id.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return [_out(g) for g in games]


@router.post("", response_model=GameOut, status_code=201)
def create_game(payload: GameCreate, db: Session = Depends(get_db)):
    if payload.home_id == payload.away_id:
        raise HTTPException(400, "Pick two different players")
    for pid in (payload.home_id, payload.away_id):
        if db.get(Player, pid) is None:
            raise HTTPException(404, f"Player {pid} not found")
    game = Game(
        home_id=payload.home_id,
        away_id=payload.away_id,
        home_score=payload.home_score,
        away_score=payload.away_score,
        played_at=payload.played_at or date.today(),
        note=payload.note,
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    return _out(game)


@router.delete("/{game_id}", status_code=204)
def delete_game(game_id: int, db: Session = Depends(get_db)):
    game = db.get(Game, game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    db.delete(game)
    db.commit()
