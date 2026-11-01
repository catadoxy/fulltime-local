"""Wall-clock duration estimate based on match length + changeover."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _players(n):
    return [client.post("/api/players", json={"name": f"E{i}"}).json()["id"] for i in range(n)]


def test_league_estimate_uses_pitches_and_slot_length():
    _reset()
    ids = _players(4)

    # 4 players, single round robin = 3 rounds x 2 matches.
    one_pitch = client.post(
        "/api/tournaments",
        json={
            "name": "Slow",
            "format": "league",
            "player_ids": ids,
            "nb_pitches": 1,
            "settings": {"match_minutes": 10, "changeover_minutes": 5},
        },
    ).json()
    est = one_pitch["estimate"]
    assert est["slot_minutes"] == 15
    assert est["slots"] == 6  # 2 matches per round on one pitch
    assert est["minutes"] == 90

    two_pitch = client.post(
        "/api/tournaments",
        json={
            "name": "Fast",
            "format": "league",
            "player_ids": ids,
            "nb_pitches": 2,
            "settings": {"match_minutes": 10, "changeover_minutes": 5},
        },
    ).json()
    est2 = two_pitch["estimate"]
    assert est2["slots"] == 3  # both matches run together
    assert est2["minutes"] == 45


def test_estimate_defaults_and_validation():
    _reset()
    ids = _players(2)
    t = client.post(
        "/api/tournaments",
        json={
            "name": "Defaults",
            "format": "league",
            "player_ids": ids,
            # out-of-range values are clamped server-side
            "settings": {"match_minutes": 0, "changeover_minutes": 999},
        },
    ).json()
    est = t["estimate"]
    assert est["match_minutes"] == 1
    assert est["changeover_minutes"] == 120
    assert est["slot_minutes"] == 121


def test_swiss_projects_remaining_rounds():
    _reset()
    ids = _players(6)
    t = client.post(
        "/api/tournaments",
        json={
            "name": "Swiss",
            "format": "swiss",
            "player_ids": ids,
            "nb_pitches": 1,
            "settings": {"rounds": 3, "match_minutes": 12, "changeover_minutes": 3},
        },
    ).json()
    est = t["estimate"]
    # 3 matches per round, 3 rounds, one slot each on one pitch (3>1 -> 3 slots).
    assert est["matches"] == 9
    assert est["slots"] == 9
    assert est["minutes"] == 9 * 15
    assert len(est["rounds"]) == 3


def test_estimate_counts_down_as_matches_are_played():
    _reset()
    ids = _players(4)
    t = client.post(
        "/api/tournaments",
        json={
            "name": "Progress",
            "format": "league",
            "player_ids": ids,
            "nb_pitches": 1,
            "settings": {"match_minutes": 10, "changeover_minutes": 5},
        },
    ).json()
    tid = t["id"]
    assert t["estimate"]["slots"] == 6
    assert t["estimate"]["remaining_slots"] == 6
    assert t["estimate"]["remaining_minutes"] == 90

    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    first = sorted(matches, key=lambda m: (m["round_number"], m["slot"]))[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{first['id']}/result",
        json={"home_score": 2, "away_score": 1},
    )
    est = client.get(f"/api/tournaments/{tid}").json()["estimate"]
    assert est["played_matches"] == 1
    assert est["remaining_matches"] == 5
    assert est["remaining_slots"] == 5
    assert est["remaining_minutes"] == 75

    # Finish the rest.
    for _ in range(20):
        matches = client.get(f"/api/tournaments/{tid}/matches").json()
        pending = [m for m in matches if not m["played"] and m["home_id"] and m["away_id"]]
        if not pending:
            break
        m = pending[0]
        client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/result",
            json={"home_score": 1, "away_score": 0},
        )
    final = client.get(f"/api/tournaments/{tid}").json()
    assert final["status"] == "completed"
    assert final["estimate"]["remaining_minutes"] == 0
    assert final["estimate"]["remaining_matches"] == 0


def test_swiss_remaining_includes_projected_rounds():
    _reset()
    ids = _players(6)
    t = client.post(
        "/api/tournaments",
        json={
            "name": "Swiss remaining",
            "format": "swiss",
            "player_ids": ids,
            "nb_pitches": 1,
            "settings": {"rounds": 3, "match_minutes": 12, "changeover_minutes": 3},
        },
    ).json()
    est = t["estimate"]
    assert est["matches"] == 9
    assert est["remaining_matches"] == 9
    assert est["remaining_slots"] == 9
    assert est["remaining_minutes"] == 9 * 15


def test_knockout_byes_do_not_add_time():
    _reset()
    ids = _players(6)  # bracket of 8 -> two byes
    t = client.post(
        "/api/tournaments",
        json={"name": "Cup", "format": "knockout", "player_ids": ids, "nb_pitches": 1},
    ).json()
    est = t["estimate"]
    # 8-slot bracket with 6 players: 2 byes, then 2 semis and the final.
    assert est["matches"] == 5
