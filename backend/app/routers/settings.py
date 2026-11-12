"""Application settings and optional football-data.org integration."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import auth, football_data
from ..database import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])
_COMPETITION_CODE = re.compile(r"^[A-Z0-9]{2,8}$")


class FootballDataTokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=500)


def _require_admin_or_open(request: Request, db: Session) -> None:
    # In open mode all users are admins by design; otherwise require an admin account.
    if auth.auth_required_db(db):
        auth.require_admin(request, db)


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    return {"football_data_configured": football_data.get_token(db) is not None}


@router.put("/football-data")
def configure_football_data(
    payload: FootballDataTokenIn,
    request: Request,
    db: Session = Depends(get_db),
):
    _require_admin_or_open(request, db)
    token = payload.token.strip()
    if not token:
        raise HTTPException(400, "Token is required")
    # Validate before replacing a working token. The token itself is never returned.
    football_data.request_json(token, "/competitions")
    football_data.save_token(db, token)
    return {"football_data_configured": True}


@router.delete("/football-data", status_code=204)
def remove_football_data(request: Request, db: Session = Depends(get_db)):
    _require_admin_or_open(request, db)
    football_data.delete_token(db)


@router.get("/football-data/competitions")
def list_competitions(db: Session = Depends(get_db)):
    return football_data.competitions(db)


@router.post("/football-data/competitions/{code}/teams")
def list_competition_teams(code: str, db: Session = Depends(get_db)):
    if not _COMPETITION_CODE.fullmatch(code):
        raise HTTPException(400, "Invalid competition code")
    teams = football_data.competition_teams(db, code)
    return [
        {
            "id": team.id,
            "name": team.name,
            "short_name": team.short_name,
            "crest_url": team.crest_url,
            "competition_code": team.competition_code,
            "competition_name": team.competition_name,
        }
        for team in teams
    ]
