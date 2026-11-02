"""Completed tournaments are read-only until explicitly reopened."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _setup_completed_league():
    ids = [
        client.post("/api/players", json={"name": f"Lock{i}"}).json()["id"] for i in range(2)
    ]
    tid = client.post(
        "/api/tournaments", json={"name": "Locked", "format": "league", "player_ids": ids}
    ).json()["id"]
    match = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{match['id']}/result",
        json={"home_score": 2, "away_score": 0},
    )
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["status"] == "completed"
    return tid, match, t


def test_completed_tournament_is_locked_until_reopened():
    _reset()
    tid, match, t = _setup_completed_league()
    assert t["champion_id"] == match["home_id"]
    assert t["finished_at"] is not None

    # Score edits and clears are rejected while closed.
    edit = client.post(
        f"/api/tournaments/{tid}/matches/{match['id']}/result",
        json={"home_score": 0, "away_score": 2},
    )
    assert edit.status_code == 400
    assert "reopen" in edit.json()["detail"].lower()
    assert client.delete(f"/api/tournaments/{tid}/matches/{match['id']}/result").status_code == 400

    # Reopen clears the completion state but keeps the results.
    reopened = client.post(f"/api/tournaments/{tid}/reopen")
    assert reopened.status_code == 200
    body = reopened.json()
    assert body["status"] == "active"
    assert body["champion_id"] is None
    assert body["finished_at"] is None
    assert body["end_date"] is None

    # Editing works and does not auto-complete a reopened event.
    edited = client.post(
        f"/api/tournaments/{tid}/matches/{match['id']}/result",
        json={"home_score": 0, "away_score": 2},
    )
    assert edited.status_code == 200
    assert client.get(f"/api/tournaments/{tid}").json()["status"] == "active"

    # Closing finishes it again and recomputes the champion.
    closed = client.post(f"/api/tournaments/{tid}/close")
    assert closed.status_code == 200
    final = closed.json()
    assert final["status"] == "completed"
    assert final["champion_id"] == match["away_id"]
    assert final["finished_at"] is not None

    # And it is locked again.
    assert (
        client.post(
            f"/api/tournaments/{tid}/matches/{match['id']}/result",
            json={"home_score": 3, "away_score": 0},
        ).status_code
        == 400
    )


def test_reopen_is_idempotent_on_active_tournament():
    _reset()
    ids = [
        client.post("/api/players", json={"name": f"Act{i}"}).json()["id"] for i in range(2)
    ]
    tid = client.post(
        "/api/tournaments", json={"name": "Active", "format": "league", "player_ids": ids}
    ).json()["id"]

    r = client.post(f"/api/tournaments/{tid}/reopen")
    assert r.status_code == 200
    assert r.json()["status"] == "active"
