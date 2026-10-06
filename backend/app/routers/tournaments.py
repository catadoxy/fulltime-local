from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Match, Tournament
from ..schemas import ResultIn, TournamentCreate, TournamentUpdate
from ..serializers import match_out, tournament_out
from ..services import fixtures, results, standings

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


@router.get("")
def list_tournaments(db: Session = Depends(get_db)):
    # Newest first by tournament date, falling back to creation time.
    order = func.coalesce(Tournament.start_date, func.date(Tournament.created_at)).desc()
    tours = db.execute(select(Tournament).order_by(order, Tournament.id.desc())).scalars().all()
    return [tournament_out(t) for t in tours]


@router.post("", status_code=201)
def create_tournament(payload: TournamentCreate, db: Session = Depends(get_db)):
    try:
        t = fixtures.create_tournament(db, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return tournament_out(t, detail=True)


@router.get("/{tournament_id}")
def get_tournament(tournament_id: int, db: Session = Depends(get_db)):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    return tournament_out(t, detail=True)


@router.patch("/{tournament_id}")
def update_tournament(tournament_id: int, payload: TournamentUpdate, db: Session = Depends(get_db)):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    data = payload.model_dump(exclude_unset=True)
    if "settings" in data and data["settings"] is not None:
        data["settings"] = {**t.settings, **data["settings"]}
    for key, value in data.items():
        setattr(t, key, value)
    db.commit()
    db.refresh(t)
    return tournament_out(t, detail=True)


@router.delete("/{tournament_id}", status_code=204)
def delete_tournament(tournament_id: int, db: Session = Depends(get_db)):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    db.delete(t)
    db.commit()


@router.post("/{tournament_id}/close")
def close_tournament(tournament_id: int, db: Session = Depends(get_db)):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    results.close_tournament(db, t)
    db.refresh(t)
    return tournament_out(t, detail=True)


@router.get("/{tournament_id}/matches")
def list_matches(tournament_id: int, db: Session = Depends(get_db)):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    matches = (
        db.execute(
            select(Match)
            .where(Match.tournament_id == tournament_id)
            .order_by(Match.round_number, Match.slot, Match.pitch, Match.match_number)
        )
        .scalars()
        .all()
    )
    return [match_out(m) for m in matches]


@router.get("/{tournament_id}/standings")
def get_standings(tournament_id: int, db: Session = Depends(get_db)):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")

    if t.format == "groups_knockout" and t.groups:
        tables = []
        for g in sorted(t.groups, key=lambda x: x.sort_order):
            tables.append(
                {"group_id": g.id, "group_name": g.name, "rows": standings.standings(db, t, group_id=g.id)}
            )
        return {"tables": tables}

    stage = "league_phase" if t.format == "champions_league" else None
    rows = standings.standings(db, t, stage=stage)
    return {"tables": [{"group_id": None, "group_name": None, "rows": rows}]}


@router.post("/{tournament_id}/matches/{match_id}/result")
def set_match_result(tournament_id: int, match_id: int, payload: ResultIn, db: Session = Depends(get_db)):
    m = db.get(Match, match_id)
    if not m or m.tournament_id != tournament_id:
        raise HTTPException(404, "Match not found")
    try:
        results.set_result(db, m, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return match_out(m)


@router.delete("/{tournament_id}/matches/{match_id}/result")
def clear_match_result(tournament_id: int, match_id: int, db: Session = Depends(get_db)):
    m = db.get(Match, match_id)
    if not m or m.tournament_id != tournament_id:
        raise HTTPException(404, "Match not found")
    results.clear_result(db, m)
    return match_out(m)
