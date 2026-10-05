from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Participant, Player
from ..schemas import PlayerCreate, PlayerOut, PlayerUpdate

router = APIRouter(prefix="/api/players", tags=["players"])


@router.get("", response_model=list[PlayerOut])
def list_players(db: Session = Depends(get_db)):
    return db.execute(select(Player).order_by(Player.name)).scalars().all()


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
