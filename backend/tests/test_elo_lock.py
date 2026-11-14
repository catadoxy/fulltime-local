"""Tournament Elo only moves when the tournament is closed."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app
from app.services.ratings import compute_ratings

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_elo_is_frozen_until_the_tournament_is_closed():
    _reset()
    players = [client.post("/api/players", json={"name": f"L{i}"}).json() for i in range(4)]
    ids = [player["id"] for player in players]
    tid = client.post(
        "/api/tournaments",
        json={"name": "Running", "format": "league", "player_ids": ids},
    ).json()["id"]

    first = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{first['id']}/result",
        json={"home_score": 5, "away_score": 0},
    )

    listing = {p["id"]: p["elo"] for p in client.get("/api/players").json()}
    assert all(elo == 1000 for elo in listing.values()), listing

    # The remaining fixtures keep their pre-tournament odds.
    before = {
        m["id"]: m["probabilities"]
        for m in client.get(f"/api/tournaments/{tid}/matches").json()
        if m["probabilities"]
    }
    second = next(m for m in client.get(f"/api/tournaments/{tid}/matches").json() if not m["played"])
    client.post(
        f"/api/tournaments/{tid}/matches/{second['id']}/result",
        json={"home_score": 3, "away_score": 0},
    )
    after = {
        m["id"]: m["probabilities"]
        for m in client.get(f"/api/tournaments/{tid}/matches").json()
        if m["probabilities"]
    }
    assert all(before[match_id] == odds for match_id, odds in after.items() if match_id in before)

    client.post(f"/api/tournaments/{tid}/close")
    closed = {p["id"]: p["elo"] for p in client.get("/api/players").json()}
    assert closed[first["home_id"]] > 1000
    assert closed[first["away_id"]] < 1000


def test_reopening_a_tournament_removes_its_results_from_ratings():
    _reset()
    players = [client.post("/api/players", json={"name": f"R{i}"}).json() for i in range(2)]
    ids = [player["id"] for player in players]
    tid = client.post(
        "/api/tournaments",
        json={"name": "Reversible", "format": "league", "player_ids": ids},
    ).json()["id"]
    match = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{match['id']}/result",
        json={"home_score": 2, "away_score": 0},
    )

    # Two players + one match means the event auto-completes.
    closed = {p["id"]: p["elo"] for p in client.get("/api/players").json()}
    assert closed[match["home_id"]] > 1000

    client.post(f"/api/tournaments/{tid}/reopen")
    reopened = {p["id"]: p["elo"] for p in client.get("/api/players").json()}
    assert all(elo == 1000 for elo in reopened.values())


def test_ratings_include_closed_event_results():
    _reset()
    players = [client.post("/api/players", json={"name": f"C{i}"}).json() for i in range(2)]
    tid = client.post(
        "/api/tournaments",
        json={"name": "Open", "format": "league", "player_ids": [p["id"] for p in players]},
    ).json()["id"]
    match = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{match['id']}/result",
        json={"home_score": 1, "away_score": 0},
    )
    # This tournament auto-completed above, so ratings should already exist.
    from app.database import SessionLocal
    from app.models import Tournament

    with SessionLocal() as db:
        assert db.get(Tournament, tid).status == "completed"
        ratings = compute_ratings(db, friendlies=False)
    assert not all(entry["elo"] == 1000 for entry in ratings.values())
