"""Import an existing legacy tournament manager database.

Accepts either the decrypted ``.sqlite`` file or the original encrypted
``.db`` export (it is decrypted on the fly using the same routine the phone app
uses). Historical tournaments are imported as completed records so their
matches and stats are preserved.
"""
from __future__ import annotations

import base64
import hashlib
import os
import sqlite3
import tempfile

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Group, Match, Participant, Player, Tournament
from .engine.knockout import STAGE_NAMES

SQLITE_MAGIC = b"SQLite format 3\x00"
SOURCE_PACKAGE = "legacy.app"
SOURCE_KEY_SUFFIX = ".1124090819881992"

FORMAT_BY_TYPE = {
    1: "league",
    2: "knockout",
    3: "champions_league",
    4: "groups_knockout",
    5: "swiss",
}


def _decrypt(data: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    raw = (SOURCE_PACKAGE + SOURCE_KEY_SUFFIX).encode("utf-8")
    key_string = base64.b64encode(raw).decode("ascii") + "\n"
    key = hashlib.sha256(key_string.encode("utf-8")).digest()
    dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    pt = dec.update(data) + dec.finalize()
    pad = pt[-1]
    if 1 <= pad <= 16 and pt[-pad:] == bytes([pad]) * pad:
        pt = pt[:-pad]
    if pt.startswith(SQLITE_MAGIC):
        return pt
    if pt[1:17] == SQLITE_MAGIC:
        return pt[1:]  # strip the version byte used by exports
    raise ValueError("Not a legacy encrypted database (decryption did not yield SQLite)")


def _to_sqlite(data: bytes) -> sqlite3.Connection:
    if not data.startswith(SQLITE_MAGIC):
        data = _decrypt(data)
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return sqlite3.connect(path)


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
    con = _to_sqlite(data)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "tournoi" not in tables or "matches" not in tables:
        raise ValueError("File does not look like a legacy database")

    cache: dict[str, int] = {}
    stats = {"players": 0, "tournaments": 0, "matches": 0, "skipped": 0}

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

        tournament = Tournament(
            name=name,
            format=fmt,
            status="completed",
            nb_pitches=max([m["numTv"] or 1 for m in matches] + [1]),
            settings={"imported": True, "source_id": tid},
            start_date=_parse_date(trow["dateDebut"]),
            end_date=_parse_date(trow["dateFin"]),
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

    con.close()
    db.commit()
    return stats


def _parse_date(value):
    if not value:
        return None
    from datetime import date, datetime

    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None
