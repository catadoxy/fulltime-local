"""Import a FullTime Local SQLite backup into the current installation."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from datetime import date, datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import FootballTeam, Game, Group, Match, Participant, Player, Tournament

SQLITE_MAGIC = b"SQLite format 3\x00"
SUPPORTED_FORMATS = {"league", "knockout", "groups_knockout", "swiss", "champions_league"}


def _sqlite_backup(data: bytes) -> tuple[sqlite3.Connection, str]:
    if not data.startswith(SQLITE_MAGIC):
        raise ValueError("Choose a FullTime Local SQLite backup exported from Settings → Backup & import.")
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    with os.fdopen(fd, "wb") as target:
        target.write(data)
    con = None
    try:
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        check = con.execute("PRAGMA quick_check").fetchone()
        if not check or check[0] != "ok":
            con.close()
            raise ValueError("The SQLite backup is damaged and cannot be imported.")
        return con, path
    except sqlite3.DatabaseError:
        if con is not None:
            con.close()
        try:
            os.unlink(path)
        except OSError:
            pass
        raise ValueError("This file is not a readable FullTime Local SQLite backup.")
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in con.execute(f'PRAGMA table_info("{table}")').fetchall()}


def _value(row: sqlite3.Row, key: str, default=None):
    return row[key] if key in row.keys() else default


def _json(value, default):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else default
        except (TypeError, ValueError):
            return default
    return default


def _date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif value:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _datetime_key(value) -> str | None:
    parsed = _datetime(value)
    return parsed.isoformat(sep=" ") if parsed else None


def _tournament_key(name, start_date, created_at) -> tuple:
    start = _date(start_date)
    return (str(name or ""), start.isoformat() if start else None, _datetime_key(created_at))


def _insert_id(db: Session, model, source_id) -> dict:
    if source_id is None:
        return {}
    source_id = int(source_id)
    return {"id": source_id} if db.get(model, source_id) is None else {}


def _wipe_data(db: Session) -> None:
    # Accounts and app settings belong to this installation and are intentionally kept.
    for model in (Match, Game, Participant, Group, Tournament, Player, FootballTeam):
        db.execute(delete(model))
    db.flush()


def import_fulltime_backup(
    db: Session,
    data: bytes,
    *,
    replace: bool = False,
    dry_run: bool = False,
) -> dict:
    con, temp_path = _sqlite_backup(data)
    try:
        tables = {
            row[0].lower()
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        required = {"players", "tournaments", "matches"}
        if not required.issubset(tables):
            raise ValueError(
                "This SQLite file is not a FullTime Local backup. It must contain players, tournaments and matches."
            )
        required_columns = {
            "players": {"id", "name"},
            "tournaments": {"id", "name", "format"},
            "matches": {"id", "tournament_id"},
        }
        for table, expected in required_columns.items():
            actual = _columns(con, table)
            if not expected.issubset(actual):
                raise ValueError(f"This FullTime Local backup is missing required {table} fields.")

        backup_counts = {
            "players": con.execute("SELECT COUNT(*) FROM players").fetchone()[0],
            "tournaments": con.execute("SELECT COUNT(*) FROM tournaments").fetchone()[0],
            "matches": con.execute("SELECT COUNT(*) FROM matches").fetchone()[0],
            "friendlies": con.execute("SELECT COUNT(*) FROM games").fetchone()[0] if "games" in tables else 0,
            "teams": con.execute("SELECT COUNT(*) FROM football_teams").fetchone()[0] if "football_teams" in tables else 0,
        }

        if replace:
            _wipe_data(db)

        stats = {
            "players": 0,
            "reused_players": 0,
            "teams": 0,
            "reused_teams": 0,
            "tournaments": 0,
            "matches": 0,
            "games": 0,
            "duplicates": 0,
            "duplicate_tournaments": 0,
            "duplicate_games": 0,
            "replaced": replace,
            "backup": backup_counts,
        }

        # Reuse players with the same name; keep a source-to-local ID map for all relations.
        player_map: dict[int, int] = {}
        existing_players = {
            player.name: player
            for player in db.execute(select(Player)).scalars().all()
        }
        for row in con.execute("SELECT * FROM players ORDER BY id").fetchall():
            source_id = _value(row, "id")
            name = _value(row, "name")
            if source_id is None or not name:
                continue
            player = existing_players.get(name)
            if player is None:
                values = {
                    "name": str(name)[:120],
                    "real_name": _value(row, "real_name"),
                    "email": _value(row, "email"),
                    "picture": _value(row, "picture"),
                    "rating": _value(row, "rating", 50),
                    "created_at": _datetime(_value(row, "created_at")),
                    **_insert_id(db, Player, source_id),
                }
                if values["created_at"] is None:
                    values.pop("created_at")
                player = Player(**values)
                db.add(player)
                db.flush()
                existing_players[player.name] = player
                stats["players"] += 1
            else:
                stats["reused_players"] += 1
            player_map[int(source_id)] = player.id

        # Team IDs are provider IDs, so they remain stable across installations.
        team_map: dict[int, int] = {}
        if "football_teams" in tables:
            for row in con.execute("SELECT * FROM football_teams ORDER BY id").fetchall():
                source_id = _value(row, "id")
                if source_id is None:
                    continue
                source_id = int(source_id)
                team = db.get(FootballTeam, source_id)
                if team is None:
                    values = {
                        "id": source_id,
                        "name": str(_value(row, "name", "Unknown team"))[:160],
                        "short_name": _value(row, "short_name"),
                        "crest_url": _value(row, "crest_url"),
                        "competition_code": str(_value(row, "competition_code", ""))[:20],
                        "competition_name": str(_value(row, "competition_name", ""))[:160],
                        "updated_at": _datetime(_value(row, "updated_at")),
                    }
                    if values["updated_at"] is None:
                        values.pop("updated_at")
                    team = FootballTeam(**values)
                    db.add(team)
                    db.flush()
                    stats["teams"] += 1
                else:
                    stats["reused_teams"] += 1
                team_map[source_id] = team.id

        existing_tournaments = {
            _tournament_key(t.name, t.start_date, t.created_at): t
            for t in db.execute(select(Tournament)).scalars().all()
        }
        tournament_map: dict[int, int | None] = {}
        source_tournaments = con.execute("SELECT * FROM tournaments ORDER BY id").fetchall()
        for row in source_tournaments:
            source_id = _value(row, "id")
            if source_id is None:
                continue
            name = str(_value(row, "name", "Imported tournament"))[:200]
            start_date = _date(_value(row, "start_date"))
            created_at = _datetime(_value(row, "created_at"))
            key = _tournament_key(name, start_date, created_at)
            if key in existing_tournaments:
                tournament_map[int(source_id)] = None
                stats["duplicates"] += 1
                stats["duplicate_tournaments"] += 1
                continue
            fmt = str(_value(row, "format", "league"))
            if fmt not in SUPPORTED_FORMATS:
                raise ValueError(f"Unsupported tournament format in backup: {fmt}")
            values = {
                "name": name,
                "note": _value(row, "note"),
                "format": fmt,
                "status": str(_value(row, "status", "completed")),
                "nb_pitches": _value(row, "nb_pitches", 1) or 1,
                "settings": _json(_value(row, "settings"), {}),
                "start_date": start_date,
                "end_date": _date(_value(row, "end_date")),
                "started_at": _datetime(_value(row, "started_at")),
                "finished_at": _datetime(_value(row, "finished_at")),
                "elapsed_minutes_override": _value(row, "elapsed_minutes_override"),
                "champion_id": player_map.get(_value(row, "champion_id")),
                "created_at": created_at,
                **_insert_id(db, Tournament, source_id),
            }
            if values["created_at"] is None:
                values.pop("created_at")
            tournament = Tournament(**values)
            db.add(tournament)
            db.flush()
            tournament_map[int(source_id)] = tournament.id
            existing_tournaments[key] = tournament
            stats["tournaments"] += 1

        group_map: dict[int, int] = {}
        if "groups" in tables:
            for row in con.execute("SELECT * FROM groups ORDER BY id").fetchall():
                source_tournament_id = _value(row, "tournament_id")
                tournament_id = tournament_map.get(source_tournament_id)
                if tournament_id is None:
                    continue
                source_id = _value(row, "id")
                values = {
                    "tournament_id": tournament_id,
                    "name": str(_value(row, "name", "Group"))[:50],
                    "sort_order": _value(row, "sort_order", 0) or 0,
                    **_insert_id(db, Group, source_id),
                }
                group = Group(**values)
                db.add(group)
                db.flush()
                if source_id is not None:
                    group_map[int(source_id)] = group.id

        if "participants" in tables:
            for row in con.execute("SELECT * FROM participants ORDER BY id").fetchall():
                tournament_id = tournament_map.get(_value(row, "tournament_id"))
                player_id = player_map.get(_value(row, "player_id"))
                if tournament_id is None or player_id is None:
                    continue
                source_id = _value(row, "id")
                db.add(Participant(
                    tournament_id=tournament_id,
                    player_id=player_id,
                    team_id=team_map.get(_value(row, "team_id")),
                    seed=_value(row, "seed"),
                    group_id=group_map.get(_value(row, "group_id")),
                    **_insert_id(db, Participant, source_id),
                ))

        match_map: dict[int, int] = {}
        pending_next: list[tuple[int, int | None]] = []
        for row in con.execute("SELECT * FROM matches ORDER BY id").fetchall():
            source_tournament_id = _value(row, "tournament_id")
            tournament_id = tournament_map.get(source_tournament_id)
            if tournament_id is None:
                continue
            source_id = _value(row, "id")
            values = {
                "tournament_id": tournament_id,
                "stage": str(_value(row, "stage", "league"))[:20],
                "group_id": group_map.get(_value(row, "group_id")),
                "round_number": _value(row, "round_number", 0) or 0,
                "match_number": _value(row, "match_number", source_id) or 0,
                "slot": _value(row, "slot", 0) or 0,
                "pitch": _value(row, "pitch"),
                "home_id": player_map.get(_value(row, "home_id")),
                "away_id": player_map.get(_value(row, "away_id")),
                "home_score": _value(row, "home_score"),
                "away_score": _value(row, "away_score"),
                "home_pen": _value(row, "home_pen"),
                "away_pen": _value(row, "away_pen"),
                "pre_home_probability": _value(row, "pre_home_probability"),
                "pre_draw_probability": _value(row, "pre_draw_probability"),
                "pre_away_probability": _value(row, "pre_away_probability"),
                "played": bool(_value(row, "played", False)),
                "winner_id": player_map.get(_value(row, "winner_id")),
                "next_slot": _value(row, "next_slot"),
                "leg": _value(row, "leg", 1) or 1,
                "note": _value(row, "note"),
                "scheduled_at": _datetime(_value(row, "scheduled_at")),
                "created_at": _datetime(_value(row, "created_at")),
                **_insert_id(db, Match, source_id),
            }
            if values["created_at"] is None:
                values.pop("created_at")
            match = Match(**values)
            db.add(match)
            db.flush()
            if source_id is not None:
                match_map[int(source_id)] = match.id
                pending_next.append((match.id, _value(row, "next_match_id")))
            stats["matches"] += 1
        for local_id, source_next_id in pending_next:
            next_id = match_map.get(source_next_id)
            if next_id is not None:
                db.get(Match, local_id).next_match_id = next_id

        existing_games = {
            (
                game.home_id,
                game.away_id,
                game.played_at.isoformat(),
                game.home_score,
                game.away_score,
                game.note,
            )
            for game in db.execute(select(Game)).scalars().all()
        }
        if "games" in tables:
            for row in con.execute("SELECT * FROM games ORDER BY id").fetchall():
                source_id = _value(row, "id")
                home_id = player_map.get(_value(row, "home_id"))
                away_id = player_map.get(_value(row, "away_id"))
                if home_id is None or away_id is None:
                    continue
                played_at = _date(_value(row, "played_at"))
                played_at = played_at or date.today()
                home_score = _value(row, "home_score", 0) or 0
                away_score = _value(row, "away_score", 0) or 0
                note = _value(row, "note")
                game_key = (home_id, away_id, played_at.isoformat(), home_score, away_score, note)
                if game_key in existing_games:
                    stats["duplicates"] += 1
                    stats["duplicate_games"] += 1
                    continue
                values = {
                    "home_id": home_id,
                    "away_id": away_id,
                    "home_team_id": team_map.get(_value(row, "home_team_id")),
                    "away_team_id": team_map.get(_value(row, "away_team_id")),
                    "home_score": home_score,
                    "away_score": away_score,
                    "played_at": played_at,
                    "note": note,
                    "created_at": _datetime(_value(row, "created_at")),
                    **_insert_id(db, Game, source_id),
                }
                if values["created_at"] is None:
                    values.pop("created_at")
                db.add(Game(**values))
                existing_games.add(game_key)
                stats["games"] += 1

        if dry_run:
            db.rollback()
        else:
            db.commit()
        return stats
    except Exception:
        db.rollback()
        raise
    finally:
        con.close()
        try:
            os.unlink(temp_path)
        except OSError:
            pass
