from __future__ import annotations

import datetime
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..config import DATABASE_URL
from ..database import engine, get_db
from ..models import Game, Group, Match, Participant, Player, Tournament
from ..services.fixtures import default_settings
from ..legacy_import import import_legacy

router = APIRouter(prefix="/api", tags=["meta"])

FORMATS = [
    {"id": "league", "label": "Championship / round-robin"},
    {"id": "knockout", "label": "Knockout"},
    {"id": "groups_knockout", "label": "Group stage + finals"},
    {"id": "swiss", "label": "Swiss system"},
    {"id": "champions_league", "label": "Champions League"},
]


@router.get("/meta")
def meta():
    return {
        "formats": FORMATS,
        "default_settings": {f["id"]: default_settings(f["id"]) for f in FORMATS},
    }


@router.post("/import/legacy")
async def import_legacy_file(
    file: UploadFile = File(...),
    replace: bool = Form(False),
    db: Session = Depends(get_db),
):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    try:
        if replace:
            _wipe(db)
        stats = import_legacy(db, data)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    return {"ok": True, "filename": file.filename, "replaced": replace, **stats}


def _wipe(db: Session) -> None:
    """Delete all local data (used by the 'replace' import option).

    Left uncommitted so it rolls back if the import then fails.
    """
    for model in (Match, Game, Participant, Group, Tournament, Player):
        db.execute(delete(model))
    db.flush()


@router.get("/export/backup")
def export_backup():
    """Download the whole application database as a portable SQLite file."""
    if not DATABASE_URL.startswith("sqlite"):
        raise HTTPException(400, "Backup export is only supported for the SQLite backend")
    path = DATABASE_URL.split("sqlite:///", 1)[1]
    if not os.path.exists(path):
        raise HTTPException(404, "Database file not found")
    # Flush WAL so the copied file is complete and self-contained.
    with engine.connect() as conn:
        try:
            conn.exec_driver_sql("PRAGMA wal_checkpoint(FULL)")
        except Exception:
            pass
    filename = f"fulltime-backup-{datetime.date.today().isoformat()}.db"
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
