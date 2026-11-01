"""Random draw by default, with manual seeding available as an opt-out."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app
from app.services import fixtures

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
        ids.append(client.post("/api/players", json={"name": f"R{_counter}"}).json()["id"])
    return ids


def _first_round(tid):
    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    return sorted(
        [m for m in matches if m["round_number"] == 0 and m["stage"] in ("sf", "r16", "qf", "r32", "r64", "final")],
        key=lambda m: m["match_number"],
    )


class _Reverse:
    def shuffle(self, seq):
        seq.reverse()


def test_manual_seeding_when_random_draw_disabled():
    _reset()
    ids = _players(4)
    t = client.post(
        "/api/tournaments",
        json={
            "name": "Seeded Cup",
            "format": "knockout",
            "player_ids": ids,
            "settings": {"random_draw": False},
        },
    ).json()

    seeds = sorted(t["participants"], key=lambda p: p["seed"])
    assert [p["player_id"] for p in seeds] == ids

    # seed_order(4) = [1, 4, 2, 3] -> (1 v 4), (2 v 3)
    first = _first_round(t["id"])
    assert (first[0]["home_id"], first[0]["away_id"]) == (ids[0], ids[3])
    assert (first[1]["home_id"], first[1]["away_id"]) == (ids[1], ids[2])


def test_random_draw_is_on_by_default(monkeypatch):
    _reset()
    ids = _players(4)
    monkeypatch.setattr(fixtures, "_SYSTEM_RANDOM", _Reverse())

    t = client.post(
        "/api/tournaments",
        json={"name": "Random Cup", "format": "knockout", "player_ids": ids},
    ).json()

    seeds = sorted(t["participants"], key=lambda p: p["seed"])
    assert [p["player_id"] for p in seeds] == list(reversed(ids))


def test_random_league_keeps_every_fixture():
    _reset()
    ids = _players(5)
    tid = client.post(
        "/api/tournaments",
        json={"name": "Random League", "format": "league", "player_ids": ids},
    ).json()["id"]

    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    pairs = {frozenset((m["home_id"], m["away_id"])) for m in matches}
    assert len(matches) == 10  # 5 players: C(5,2)
    assert len(pairs) == 10
