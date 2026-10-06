from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _make_players(n):
    ids = []
    for i in range(n):
        r = client.post("/api/players", json={"name": f"CR{i+1}"})
        ids.append(r.json()["id"])
    return ids


def _play_all(tid):
    for _ in range(50):
        matches = client.get(f"/api/tournaments/{tid}/matches").json()
        pending = [m for m in matches if not m["played"] and m["home_id"] and m["away_id"]]
        if not pending:
            break
        m = pending[0]
        r = client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/result",
            json={"home_score": 2, "away_score": 1},
        )
        assert r.status_code == 200, r.text


def test_clear_result_cascades_downstream():
    """Clearing a semifinal must clear the fed final (and champion)."""
    _reset()
    ids = _make_players(4)
    tid = client.post(
        "/api/tournaments", json={"name": "Cascade", "format": "knockout", "player_ids": ids}
    ).json()["id"]
    _play_all(tid)
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["status"] == "completed"
    assert t["champion_id"] is not None

    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    sf = next(m for m in matches if m["stage"] == "sf" and m["played"])
    final = next(m for m in matches if m["stage"] == "final")

    r = client.delete(f"/api/tournaments/{tid}/matches/{sf['id']}/result")
    assert r.status_code == 200, r.text

    matches2 = client.get(f"/api/tournaments/{tid}/matches").json()
    final2 = next(m for m in matches2 if m["id"] == final["id"])
    assert final2["played"] is False
    assert final2["winner_id"] is None

    t2 = client.get(f"/api/tournaments/{tid}").json()
    assert t2["status"] == "active"
    assert t2["champion_id"] is None


def test_pagination_params():
    _reset()
    _make_players(3)
    r = client.get("/api/players?limit=2&offset=1")
    assert r.status_code == 200
    assert len(r.json()) == 2
    r2 = client.get("/api/games?limit=10")
    assert r2.status_code == 200
    r3 = client.get("/api/tournaments?limit=10&offset=0")
    assert r3.status_code == 200
