"""Small server-side client for football-data.org and its stored API token."""
from __future__ import annotations

import base64
import hashlib

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import _secret
from .models import AppSetting, FootballTeam

API_BASE = "https://api.football-data.org/v4"
TOKEN_KEY = "football_data_token"


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(_secret()).digest())
    return Fernet(key)


def get_token(db: Session) -> str | None:
    setting = db.get(AppSetting, TOKEN_KEY)
    if not setting:
        return None
    try:
        return _fernet().decrypt(setting.value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        # The user may have restored the database without the original FTL_SECRET.
        # Treat it as disconnected so Settings can safely replace the stale value.
        return None


def save_token(db: Session, token: str) -> None:
    value = _fernet().encrypt(token.encode("utf-8")).decode("ascii")
    setting = db.get(AppSetting, TOKEN_KEY)
    if setting:
        setting.value = value
    else:
        db.add(AppSetting(key=TOKEN_KEY, value=value))
    db.commit()


def delete_token(db: Session) -> None:
    setting = db.get(AppSetting, TOKEN_KEY)
    if setting:
        db.delete(setting)
        db.commit()


def request_json(token: str, path: str) -> dict:
    try:
        response = httpx.get(
            f"{API_BASE}{path}",
            headers={"X-Auth-Token": token},
            timeout=8,
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "football-data.org did not respond in time")
    except httpx.RequestError:
        raise HTTPException(502, "Could not reach football-data.org")

    if response.status_code == 401:
        raise HTTPException(400, "The football-data.org token was rejected")
    if response.status_code == 403:
        raise HTTPException(403, "football-data.org denied this request; check your plan and competition access")
    if response.status_code == 429:
        raise HTTPException(429, "football-data.org rate limit reached; please try again shortly")
    if response.status_code >= 500:
        raise HTTPException(502, "football-data.org is temporarily unavailable")
    if not response.is_success:
        raise HTTPException(502, f"football-data.org returned HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError:
        raise HTTPException(502, "football-data.org returned an invalid response")
    if not isinstance(data, dict):
        raise HTTPException(502, "football-data.org returned an unexpected response")
    return data


def competitions(db: Session) -> list[dict]:
    token = get_token(db)
    if not token:
        raise HTTPException(409, "Add a football-data.org token in Settings first")
    data = request_json(token, "/competitions")
    return [
        {"id": c.get("id"), "code": c.get("code"), "name": c.get("name"), "emblem": c.get("emblem")}
        for c in data.get("competitions", [])
        if c.get("code") and c.get("name")
    ]


def competition_teams(db: Session, code: str) -> list[FootballTeam]:
    token = get_token(db)
    if not token:
        raise HTTPException(409, "Add a football-data.org token in Settings first")

    data = request_json(token, f"/competitions/{code}/teams")
    competition = data.get("competition") if isinstance(data.get("competition"), dict) else {}
    competition_name = str(competition.get("name") or code)
    teams_data = data.get("teams", [])
    if not isinstance(teams_data, list):
        raise HTTPException(502, "football-data.org returned an unexpected team list")

    teams: list[FootballTeam] = []
    for item in teams_data:
        if not isinstance(item, dict) or not isinstance(item.get("id"), int) or not item.get("name"):
            continue
        team = db.get(FootballTeam, item["id"])
        if team is None:
            team = FootballTeam(
                id=item["id"],
                name=str(item["name"])[:160],
                short_name=str(item["shortName"])[:100] if item.get("shortName") else None,
                crest_url=str(item["crest"])[:500] if item.get("crest") else None,
                competition_code=code,
                competition_name=competition_name[:160],
            )
            db.add(team)
        else:
            team.name = str(item["name"])[:160]
            team.short_name = str(item["shortName"])[:100] if item.get("shortName") else None
            team.crest_url = str(item["crest"])[:500] if item.get("crest") else None
            team.competition_code = code
            team.competition_name = competition_name[:160]
        teams.append(team)
    db.commit()
    return teams


def find_teams(db: Session, team_ids: set[int]) -> dict[int, FootballTeam]:
    if not team_ids:
        return {}
    teams = db.execute(select(FootballTeam).where(FootballTeam.id.in_(team_ids))).scalars().all()
    return {team.id: team for team in teams}
