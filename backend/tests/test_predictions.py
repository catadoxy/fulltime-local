"""Win/draw/loss estimates for unplayed matches."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app
from app.models import Match
from app.services.predictions import match_probabilities
from app.services.results import upset_of

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _player(name: str) -> dict:
    return client.post("/api/players", json={"name": name}).json()


def test_probabilities_are_sane_and_sum_to_one_hundred():
    level = match_probabilities(1000, 1000)
    assert set(level) == {"home", "draw", "away"}
    assert sum(level.values()) == 100
    assert level["home"] == level["away"]
    assert 10 <= level["draw"] <= 24

    strong = match_probabilities(1200, 900)
    assert sum(strong.values()) == 100
    assert strong["home"] > strong["away"]
    assert strong["draw"] < level["draw"]

    upset = match_probabilities(900, 1200)
    assert sum(upset.values()) == 100
    assert upset["away"] > upset["home"]


def test_matches_include_estimates_only_while_unplayed():
    _reset()
    favorite = _player("Favorite")
    underdog = _player("Underdog")
    tid = client.post(
        "/api/tournaments",
        json={"name": "Estimate", "format": "league", "player_ids": [favorite["id"], underdog["id"]]},
    ).json()["id"]

    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    assert len(matches) == 1
    pending = matches[0]
    assert sum(pending["probabilities"].values()) == 100

    client.post(
        f"/api/tournaments/{tid}/matches/{pending['id']}/result",
        json={"home_score": 3, "away_score": 0},
    )
    played = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    assert played["probabilities"] is None
    assert set(played["pre_match_probabilities"]) == {"home", "draw", "away"}
    assert sum(played["pre_match_probabilities"].values()) == 100
    # Evenly matched players are not an upset, whichever way it went.
    assert played["upset"] is None


def test_upset_detection_uses_the_pre_match_snapshot():
    underdog_win = Match(
        home_id=1,
        away_id=2,
        played=True,
        winner_id=2,
        pre_home_probability=82,
        pre_draw_probability=10,
        pre_away_probability=8,
    )
    upset = upset_of(underdog_win)
    assert upset == {"player_id": 2, "probability": 8, "opponent_probability": 82}

    favourite_win = Match(
        home_id=1,
        away_id=2,
        played=True,
        winner_id=1,
        pre_home_probability=82,
        pre_draw_probability=10,
        pre_away_probability=8,
    )
    assert upset_of(favourite_win) is None

    narrow = Match(
        home_id=1,
        away_id=2,
        played=True,
        winner_id=2,
        pre_home_probability=45,
        pre_draw_probability=24,
        pre_away_probability=31,
    )
    assert upset_of(narrow) is None

    unplayed = Match(home_id=1, away_id=2, played=False)
    assert upset_of(unplayed) is None


def test_estimates_favour_the_stronger_record():
    _reset()
    stronger = _player("Stronger")
    weaker = _player("Weaker")

    decided = client.post(
        "/api/tournaments",
        json={"name": "Decided", "format": "league", "player_ids": [stronger["id"], weaker["id"]]},
    ).json()["id"]
    match = client.get(f"/api/tournaments/{decided}/matches").json()[0]
    client.post(
        f"/api/tournaments/{decided}/matches/{match['id']}/result",
        json={
            "home_score": 4 if match["home_id"] == stronger["id"] else 0,
            "away_score": 4 if match["away_id"] == stronger["id"] else 0,
        },
    )

    forecast = client.post(
        "/api/tournaments",
        json={"name": "Forecast", "format": "league", "player_ids": [stronger["id"], weaker["id"]]},
    ).json()["id"]
    pending = client.get(f"/api/tournaments/{forecast}/matches").json()[0]
    probabilities = pending["probabilities"]
    assert sum(probabilities.values()) == 100
    if pending["home_id"] == stronger["id"]:
        assert probabilities["home"] > probabilities["away"]
    else:
        assert probabilities["away"] > probabilities["home"]
