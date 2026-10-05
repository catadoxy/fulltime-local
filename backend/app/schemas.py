from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TournamentFormat = Literal["league", "knockout", "groups_knockout", "swiss", "champions_league"]


# ---------- Players ----------
class PlayerBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str | None = None
    picture: str | None = None
    rating: int = Field(default=50, ge=0, le=100)


class PlayerCreate(PlayerBase):
    pass


class PlayerUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    picture: str | None = None
    rating: int | None = Field(default=None, ge=0, le=100)


class PlayerOut(PlayerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tournaments: int = 0
    titles: int = 0


# ---------- Tournaments ----------
class TournamentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    format: TournamentFormat = "league"
    player_ids: list[int] = Field(default_factory=list)
    nb_pitches: int = Field(default=1, ge=1, le=64)
    settings: dict[str, Any] = Field(default_factory=dict)
    start_date: date | None = None


class TournamentUpdate(BaseModel):
    name: str | None = None
    nb_pitches: int | None = Field(default=None, ge=1, le=64)
    settings: dict[str, Any] | None = None


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sort_order: int


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    player_id: int
    player: PlayerOut
    seed: int | None = None
    group_id: int | None = None


class TournamentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    format: str
    status: str
    nb_pitches: int
    settings: dict[str, Any]
    start_date: date | None
    end_date: date | None
    champion_id: int | None
    created_at: datetime


class TournamentDetail(TournamentOut):
    groups: list[GroupOut] = Field(default_factory=list)
    participants: list[ParticipantOut] = Field(default_factory=list)


# ---------- Matches ----------
class MatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    stage: str
    group_id: int | None
    round_number: int
    match_number: int
    pitch: int | None
    home_id: int | None
    away_id: int | None
    home_name: str | None = None
    away_name: str | None = None
    home_score: int | None
    away_score: int | None
    home_pen: int | None
    away_pen: int | None
    played: bool
    winner_id: int | None
    leg: int
    note: str | None


class ResultIn(BaseModel):
    home_score: int = Field(ge=0, le=999)
    away_score: int = Field(ge=0, le=999)
    home_pen: int | None = Field(default=None, ge=0, le=999)
    away_pen: int | None = Field(default=None, ge=0, le=999)


class StandingRow(BaseModel):
    player_id: int
    player_name: str
    played: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    goal_diff: int
    points: int


class TableOut(BaseModel):
    group_id: int | None
    group_name: str | None
    rows: list[StandingRow]
