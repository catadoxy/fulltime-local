"""Import a legacy SQLite database (unencrypted).

Uploads a plain SQLite file using the source app's schema. Historical
tournaments are imported as completed records so their matches and stats are
preserved.
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import tempfile
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Group, Match, Participant, Player, Tournament
from .engine.knockout import STAGE_NAMES

SQLITE_MAGIC = b"SQLite format 3\x00"

FORMAT_BY_TYPE = {
    1: "league",
    2: "knockout",
    3: "champions_league",
    4: "groups_knockout",
    5: "swiss",
}


def _to_sqlite(data: bytes) -> tuple[sqlite3.Connection, str]:
    if not data.startswith(SQLITE_MAGIC):
        raise ValueError("Not a SQLite database (only unencrypted .sqlite files are supported)")
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return sqlite3.connect(path), path


def _get_or_create_player(db: Session, cache: dict, name: str, email=None, picture=None, rating=None) -> int:
    if name in cache:
        return cache[name]
    existing = db.execute(select(Player).where(Player.name == name)).scalar_one_or_none()
    if existing is None:
        existing = Player(name=name, email=email, picture=picture, rating=rating if rating is not None else 50)
        db.add(existing)
        db.flush()
    cache[name] = existing.id
    return existing.id


def _stage_for_round(matches_in_round: int) -> str:
    return STAGE_NAMES.get(matches_in_round, f"r{matches_in_round}")


def import_legacy(db: Session, data: bytes, *, progress=None) -> dict:
    con, tmp_path = _to_sqlite(data)
    try:
        con.row_factory = sqlite3.Row
        cur = con.cursor()

        tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "tournoi" not in tables or "matches" not in tables:
            raise ValueError("File does not look like a supported database export")

        cache: dict[str, int] = {}
        stats = {"players": 0, "tournaments": 0, "matches": 0, "skipped": 0, "duplicates": 0}

        file_hash = hashlib.sha256(data).hexdigest()

        # Skip tournaments already imported from this file (or one with the same
        # name + date), so re-importing the same export is idempotent.
        seen_hash: set[tuple] = set()
        seen_name_date: set[tuple] = set()
        for existing in db.execute(select(Tournament)).scalars().all():
            s = existing.settings or {}
            if s.get("imported"):
                seen_hash.add((s.get("import_hash"), s.get("source_id")))
                seen_name_date.add((existing.name, str(existing.start_date)))

        # Players
        for row in cur.execute("SELECT pseudo, email, picture, note FROM joueur").fetchall():
            if not row["pseudo"]:
                continue
            before = len(cache)
            _get_or_create_player(
                db, cache, row["pseudo"], row["email"] or None, row["picture"] or None, row["note"]
            )
            if len(cache) > before:
                stats["players"] += 1

        types: dict[int, int] = {}
        if "configuration" in tables:
            for row in cur.execute("SELECT idTournoi, idTypeTournoi FROM configuration").fetchall():
                types[row["idTournoi"]] = row["idTypeTournoi"]

        champions: dict[int, str] = {}
        if "champion" in tables:
            for row in cur.execute("SELECT idTournoi, nomJoueur FROM champion").fetchall():
                champions[row["idTournoi"]] = row["nomJoueur"]

        for trow in cur.execute(
            "SELECT idTournoi, nomTournoi, dateDebut, dateFin FROM tournoi ORDER BY idTournoi"
        ).fetchall():
            tid = trow["idTournoi"]
            name = trow["nomTournoi"] or f"Imported tournament {tid}"
            fmt = FORMAT_BY_TYPE.get(types.get(tid, 1), "league")

            matches = cur.execute(
                "SELECT * FROM matches WHERE idTournoi=? ORDER BY numTour, idMatch", (tid,)
            ).fetchall()
            if not matches:
                stats["skipped"] += 1
                continue

            # The source schema has no creation timestamp; use the tournament's start
            # date (falling back to its end date) as the effective creation date.
            start_dt = _parse_datetime(trow["dateDebut"]) or _parse_datetime(trow["dateFin"])
            end_dt = _parse_datetime(trow["dateFin"])

            candidate_date = str(start_dt.date() if start_dt else None)
            if (file_hash, tid) in seen_hash or (name, candidate_date) in seen_name_date:
                stats["duplicates"] += 1
                continue

            tournament = Tournament(
                name=name,
                format=fmt,
                status="completed",
                nb_pitches=max([m["numTv"] or 1 for m in matches] + [1]),
                settings={"imported": True, "source_id": tid, "import_hash": file_hash},
                start_date=start_dt.date() if start_dt else None,
                end_date=end_dt.date() if end_dt else None,
                created_at=start_dt or datetime.now(timezone.utc).replace(tzinfo=None),
            )
            db.add(tournament)
            db.flush()

            group_cache: dict[int, int] = {}
            # Determine every player taking part.
            participant_names = set()
            for m in matches:
                if m["idJoueur1"]:
                    participant_names.add(m["idJoueur1"])
                if m["idJoueur2"]:
                    participant_names.add(m["idJoueur2"])
            for n in participant_names:
                pid = _get_or_create_player(db, cache, n)
                db.add(Participant(tournament_id=tournament.id, player_id=pid))

            # Round sizes are needed to name knockout stages.
            round_sizes: dict[int, int] = {}
            for m in matches:
                round_sizes[m["numTour"] or 0] = round_sizes.get(m["numTour"] or 0, 0) + 1

            for m in matches:
                knockout = m["gagnantMatch1"] is not None or (
                    fmt == "knockout" and m["idPoule"] in (None, 0)
                )
                group_id = None
                if fmt in ("groups_knockout", "champions_league") and not knockout:
                    key = m["idPoule"] or 1
                    if key not in group_cache:
                        grp = Group(tournament_id=tournament.id, name=f"Group {key}", sort_order=key)
                        db.add(grp)
                        db.flush()
                        group_cache[key] = grp.id
                    group_id = group_cache[key]

                if fmt == "league":
                    stage = "league"
                elif fmt == "swiss":
                    stage = "swiss"
                elif fmt == "champions_league" and not knockout:
                    stage = "league_phase"
                elif fmt == "groups_knockout" and not knockout:
                    stage = "group"
                else:
                    stage = _stage_for_round(round_sizes.get(m["numTour"] or 0, 1))

                home = _get_or_create_player(db, cache, m["idJoueur1"]) if m["idJoueur1"] else None
                away = _get_or_create_player(db, cache, m["idJoueur2"]) if m["idJoueur2"] else None
                winner = _get_or_create_player(db, cache, m["nomGagnant"]) if m["nomGagnant"] else None

                db.add(
                    Match(
                        tournament_id=tournament.id,
                        stage=stage,
                        group_id=group_id,
                        round_number=(m["numTour"] or 0),
                        match_number=(m["numMatch"] if m["numMatch"] is not None else m["idMatch"]),
                        pitch=m["numTv"] or 1,
                        home_id=home,
                        away_id=away,
                        home_score=m["scoreJ1"],
                        away_score=m["scoreJ2"],
                        home_pen=(m["tabJ1"] if m["tabJ1"] is not None and m["tabJ1"] >= 0 else None),
                        away_pen=(m["tabJ2"] if m["tabJ2"] is not None and m["tabJ2"] >= 0 else None),
                        played=bool(m["saisi"]),
                        winner_id=winner,
                        note=m["note"],
                    )
                )
                stats["matches"] += 1

            champ = champions.get(tid)
            if champ:
                tournament.champion_id = _get_or_create_player(db, cache, champ)

            stats["tournaments"] += 1
            if progress:
                progress(stats)

        db.commit()
        return stats
    finally:
        try:
            con.close()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _parse_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
        "%d.%m.%Y",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _parse_date(value):
    dt = _parse_datetime(value)
    return dt.date() if dt else None
