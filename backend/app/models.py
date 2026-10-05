from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), default=None)
    picture: Mapped[str | None] = mapped_column(String(500), default=None)
    rating: Mapped[int] = mapped_column(Integer, default=50)  # 0..100, for seeding/simulator
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # league | knockout | groups_knockout | swiss | champions_league
    format: Mapped[str] = mapped_column(String(40))
    # active | completed
    status: Mapped[str] = mapped_column(String(20), default="active")
    nb_pitches: Mapped[int] = mapped_column(Integer, default=1)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    start_date: Mapped[date | None] = mapped_column(Date, default=None)
    end_date: Mapped[date | None] = mapped_column(Date, default=None)
    champion_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    groups: Mapped[list["Group"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan", order_by="Group.sort_order"
    )
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan"
    )
    matches: Mapped[list["Match"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan"
    )


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    tournament: Mapped[Tournament] = relationship(back_populates="groups")


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (UniqueConstraint("tournament_id", "player_id", name="uq_participant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    seed: Mapped[int | None] = mapped_column(Integer, default=None)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"), default=None)

    tournament: Mapped[Tournament] = relationship(back_populates="participants")
    player: Mapped[Player] = relationship()


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    # league | group | league_phase | swiss | r32 | r16 | qf | sf | third | final
    stage: Mapped[str] = mapped_column(String(20), default="league")
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"), default=None)
    round_number: Mapped[int] = mapped_column(Integer, default=0)
    match_number: Mapped[int] = mapped_column(Integer, default=0)
    slot: Mapped[int] = mapped_column(Integer, default=0)  # time slot within a round
    pitch: Mapped[int | None] = mapped_column(Integer, default=None)

    home_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), default=None)
    away_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), default=None)

    home_score: Mapped[int | None] = mapped_column(Integer, default=None)
    away_score: Mapped[int | None] = mapped_column(Integer, default=None)
    home_pen: Mapped[int | None] = mapped_column(Integer, default=None)
    away_pen: Mapped[int | None] = mapped_column(Integer, default=None)

    played: Mapped[bool] = mapped_column(Boolean, default=False)
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), default=None)

    # Knockout progression: winner of this match goes into next_match_id / next_slot.
    next_match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id", ondelete="SET NULL"), default=None)
    next_slot: Mapped[str | None] = mapped_column(String(5), default=None)  # home | away
    leg: Mapped[int] = mapped_column(Integer, default=1)

    note: Mapped[str | None] = mapped_column(String(500), default=None)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    tournament: Mapped[Tournament] = relationship(back_populates="matches")
    home: Mapped[Player | None] = relationship(foreign_keys=[home_id])
    away: Mapped[Player | None] = relationship(foreign_keys=[away_id])
    winner: Mapped[Player | None] = relationship(foreign_keys=[winner_id])


class Game(Base):
    """A one-off / friendly match that isn't part of any tournament."""

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(primary_key=True)
    played_at: Mapped[date] = mapped_column(Date, default=date.today)
    home_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    away_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    home_score: Mapped[int] = mapped_column(Integer, default=0)
    away_score: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    home: Mapped[Player] = relationship(foreign_keys=[home_id])
    away: Mapped[Player] = relationship(foreign_keys=[away_id])
