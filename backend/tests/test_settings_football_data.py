from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import AppSetting


client = TestClient(app)


class FakeResponse:
    status_code = 200
    is_success = True

    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_optional_football_data_settings_and_tournament_teams(monkeypatch):
    _reset()
    requested = []

    def fake_get(url, headers, timeout):
        requested.append((url, headers, timeout))
        if url.endswith("/competitions"):
            return FakeResponse({
                "competitions": [
                    {"id": 2021, "code": "PL", "name": "Premier League", "emblem": "https://example.test/pl.png"}
                ]
            })
        if url.endswith("/competitions/PL/teams"):
            return FakeResponse({
                "competition": {"name": "Premier League"},
                "teams": [
                    {"id": 64, "name": "Liverpool FC", "shortName": "Liverpool", "crest": "https://example.test/liverpool.png"},
                    {"id": 65, "name": "Manchester City FC", "shortName": "Man City", "crest": "https://example.test/city.png"},
                ],
            })
        raise AssertionError(f"Unexpected request: {url}")

    monkeypatch.setattr("app.football_data.httpx.get", fake_get)

    assert client.get("/api/settings").json() == {"football_data_configured": False}
    bad = client.put("/api/settings/football-data", json={"token": " "})
    assert bad.status_code == 400

    saved = client.put("/api/settings/football-data", json={"token": "secret-test-token"})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"football_data_configured": True}
    assert "secret-test-token" not in client.get("/api/settings").text
    with SessionLocal() as db:
        stored = db.get(AppSetting, "football_data_token")
        assert stored is not None and stored.value != "secret-test-token"

    competitions = client.get("/api/settings/football-data/competitions")
    assert competitions.status_code == 200
    assert competitions.json()[0]["code"] == "PL"
    teams = client.post("/api/settings/football-data/competitions/PL/teams", json={})
    assert teams.status_code == 200
    assert teams.json()[0]["crest_url"] == "https://example.test/liverpool.png"
    assert all(headers["X-Auth-Token"] == "secret-test-token" for _, headers, _ in requested)

    players = [client.post("/api/players", json={"name": f"Player {i}"}).json() for i in (1, 2)]
    created = client.post("/api/tournaments", json={
        "name": "Badge test",
        "format": "league",
        "player_ids": [p["id"] for p in players],
        "participant_teams": {str(players[0]["id"]): 64, str(players[1]["id"]): 64},
    })
    assert created.status_code == 201, created.text
    assigned = [p["team"] for p in created.json()["participants"]]
    assert [team["name"] for team in assigned] == ["Liverpool FC", "Liverpool FC"]
    assert [team["crest_url"] for team in assigned] == [
        "https://example.test/liverpool.png", "https://example.test/liverpool.png"
    ]

    assert client.delete("/api/settings/football-data").status_code == 204
    assert client.get("/api/settings").json() == {"football_data_configured": False}
    # Existing assignments remain as locally stored team records.
    assert client.get(f"/api/tournaments/{created.json()['id']}").json()["participants"][0]["team"]["id"] == 64


def test_tournament_rejects_team_for_unselected_player():
    _reset()
    player = client.post("/api/players", json={"name": "Only selected player"}).json()
    other = client.post("/api/players", json={"name": "Not selected"}).json()
    response = client.post("/api/tournaments", json={
        "name": "Invalid affiliation",
        "format": "league",
        "player_ids": [player["id"]],
        "participant_teams": {str(other["id"]): 999},
    })
    assert response.status_code == 400
