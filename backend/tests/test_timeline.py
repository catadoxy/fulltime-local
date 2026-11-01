"""Player timeline used by the profile charts."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_timeline_matches_current_elo():
    _reset()
    ids = [
        client.post("/api/players", json={"name": f"T{i}"}).json()["id"] for i in range(3)
    ]
    tid = client.post(
        "/api/tournaments",
        json={"name": "Timeline", "format": "league", "player_ids": ids},
    ).json()["id"]

    for _ in range(20):
        matches = client.get(f"/api/tournaments/{tid}/matches").json()
        pending = [m for m in matches if not m["played"] and m["home_id"] and m["away_id"]]
        if not pending:
            break
        m = pending[0]
        client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/result",
            json={"home_score": 3, "away_score": 1},
        )

    client.post(
        "/api/games",
        json={"home_id": ids[0], "away_id": ids[1], "home_score": 2, "away_score": 2},
    )

    pid = ids[0]
    tl = client.get(f"/api/players/{pid}/timeline").json()
    t_points, f_points = tl["tournaments"], tl["friendlies"]

    assert len(t_points) == 2  # 3-player round robin
    assert len(f_points) == 1
    assert [p["match"] for p in t_points] == [1, 2]

    # Cumulative goals are monotonic and consistent with the match scores.
    assert t_points[-1]["cumulative_goals_for"] == sum(p["goals_for"] for p in t_points)
    assert t_points[-1]["cumulative_goals_against"] == sum(
        p["goals_against"] for p in t_points
    )

    # The last timeline point equals the live rating shown on the profile.
    stats = client.get(f"/api/players/{pid}/stats").json()
    assert t_points[-1]["elo"] == stats["rating"]["elo"]
    assert t_points[-1]["rating"] == stats["rating"]["rating"]
    assert f_points[-1]["elo"] == stats["friendly_rating"]["elo"]

    # Results are labelled W/D/L per match.
    assert all(p["result"] in ("W", "D", "L") for p in t_points + f_points)

    assert client.get("/api/players/999999/timeline").status_code == 404
