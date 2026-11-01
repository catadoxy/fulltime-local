"""Real wall-clock timing and the learned slot calibration."""
from datetime import datetime

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Tournament

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


_counter = 0


def _players(n):
    global _counter
    ids = []
    for _ in range(n):
        _counter += 1
        ids.append(client.post("/api/players", json={"name": f"T{_counter}"}).json()["id"])
    return ids


def _finish_two_player_league(name="Timed"):
    ids = _players(2)
    tid = client.post(
        "/api/tournaments",
        json={"name": name, "format": "league", "player_ids": ids},
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result",
        json={"home_score": 2, "away_score": 1},
    )
    return tid


def test_started_and_finished_timestamps_round_trip():
    _reset()
    tid = _finish_two_player_league()

    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["status"] == "completed"
    assert t["started_at"] is not None
    assert t["finished_at"] is not None
    assert t["finished_at"] >= t["started_at"]

    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.delete(f"/api/tournaments/{tid}/matches/{m['id']}/result")

    reopened = client.get(f"/api/tournaments/{tid}").json()
    assert reopened["status"] == "active"
    assert reopened["finished_at"] is None
    # No results left, so the event is "not started" again.
    assert reopened["started_at"] is None


def test_close_tournament_stamps_finished_at():
    _reset()
    ids = _players(4)
    tid = client.post(
        "/api/tournaments", json={"name": "Closed", "format": "league", "player_ids": ids}
    ).json()["id"]

    t = client.post(f"/api/tournaments/{tid}/close").json()
    assert t["status"] == "completed"
    assert t["finished_at"] is not None
    assert t["started_at"] is None  # closed before any match was played


def test_meta_calibration_uses_actual_slot_times():
    _reset()
    tids = [_finish_two_player_league("A"), _finish_two_player_league("B")]

    db = SessionLocal()
    try:
        for tid in tids:
            t = db.get(Tournament, tid)
            t.started_at = datetime(2026, 1, 1, 18, 0, 0)
            t.finished_at = datetime(2026, 1, 1, 18, 30, 0)  # 30 min for 1 slot
        db.commit()
    finally:
        db.close()

    meta = client.get("/api/meta").json()
    calibration = meta["calibration"]
    assert calibration["samples"] == 2
    assert calibration["median_slot_minutes"] == 30.0


def test_calibration_ignores_untimed_tournaments():
    _reset()
    # Completed via import-style flow, without real timestamps.
    _finish_two_player_league("Untimed")
    db = SessionLocal()
    try:
        for t in db.query(Tournament).all():
            t.started_at = None
            t.finished_at = None
        db.commit()
    finally:
        db.close()

    meta = client.get("/api/meta").json()
    assert meta["calibration"]["samples"] == 0
    assert meta["calibration"]["median_slot_minutes"] is None
