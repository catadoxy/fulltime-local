from __future__ import annotations

import datetime
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DATABASE_URL
from ..database import engine, get_db
from ..fulltime_import import import_fulltime_backup
from ..models import Game, Tournament
from ..services.estimate import slot_calibration
from ..services.fixtures import default_settings

router = APIRouter(prefix="/api", tags=["meta"])

FORMATS = [
    {"id": "league", "label": "Championship / round-robin"},
    {"id": "knockout", "label": "Knockout"},
    {"id": "groups_knockout", "label": "Group stage + finals"},
    {"id": "swiss", "label": "Swiss system"},
    {"id": "champions_league", "label": "Champions League"},
]


@router.get("/meta")
def meta(db: Session = Depends(get_db)):
    tags_by_key: dict[str, str] = {}
    notes = [
        *db.execute(select(Tournament.note).where(Tournament.note.is_not(None))).scalars().all(),
        *db.execute(select(Game.note).where(Game.note.is_not(None))).scalars().all(),
    ]
    for note in notes:
        tag = str(note).strip()
        if tag:
            tags_by_key.setdefault(tag.casefold(), tag)
    return {
        "formats": FORMATS,
        "default_settings": {f["id"]: default_settings(f["id"]) for f in FORMATS},
        "calibration": slot_calibration(db),
        "game_tags": sorted(tags_by_key.values(), key=str.casefold),
    }


@router.post("/import/fulltime")
async def import_fulltime_file(
    file: UploadFile = File(...),
    replace: bool = Form(False),
    db: Session = Depends(get_db),
):
    data = await file.read(100 * 1024 * 1024 + 1)
    if len(data) > 100 * 1024 * 1024:
        raise HTTPException(413, "File is too large (max 100 MB)")
    if not data:
        raise HTTPException(400, "Empty file")
    try:
        stats = import_fulltime_backup(db, data, replace=replace)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    return {"ok": True, "filename": file.filename, "replaced": replace, **stats}


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
