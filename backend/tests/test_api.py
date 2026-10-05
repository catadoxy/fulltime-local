import sqlite3

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
        r = client.post("/api/players", json={"name": f"P{i+1}"})
        ids.append(r.json()["id"])
    return ids


def _play_all(tid, max_rounds=200):
    for _ in range(max_rounds):
        matches = client.get(f"/api/tournaments/{tid}/matches").json()
        pending = [
            m for m in matches if not m["played"] and m["home_id"] and m["away_id"]
        ]
        if not pending:
            break
        m = pending[0]
        r = client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/result",
            json={"home_score": 2, "away_score": 1},
        )
        assert r.status_code == 200, r.text


def test_league():
    _reset()
    ids = _make_players(6)
    r = client.post(
        "/api/tournaments",
        json={"name": "Ligue", "format": "league", "player_ids": ids, "nb_pitches": 2},
    )
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    assert len(matches) == 15  # 6 teams round-robin
    _play_all(tid)
    table = client.get(f"/api/tournaments/{tid}/standings").json()["tables"][0]["rows"]
    assert sum(row["played"] for row in table) == 30  # each match counted twice
    assert sum(row["points"] for row in table) == 45  # every match had a winner (3 pts)
    # Pitches are respected within a slot.
    by_slot = {}
    for m in client.get(f"/api/tournaments/{tid}/matches").json():
        by_slot.setdefault((m["round_number"], m["slot"]), []).append(m)
    for group in by_slot.values():
        assert len(group) <= 2


def test_knockout_with_byes():
    _reset()
    ids = _make_players(6)
    r = client.post(
        "/api/tournaments", json={"name": "Cup", "format": "knockout", "player_ids": ids}
    )
    tid = r.json()["id"]
    t = client.get(f"/api/tournaments/{tid}").json()
    _play_all(tid)
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["status"] == "completed"
    assert t["champion_id"] is not None


def test_groups_knockout():
    _reset()
    ids = _make_players(8)
    r = client.post(
        "/api/tournaments",
        json={
            "name": "World Cup",
            "format": "groups_knockout",
            "player_ids": ids,
            "settings": {"nb_groups": 2, "qualifiers_per_group": 2},
        },
    )
    tid = r.json()["id"]
    tables = client.get(f"/api/tournaments/{tid}/standings").json()["tables"]
    assert len(tables) == 2
    _play_all(tid)
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["settings"]["knockout_seeded"] is True
    assert t["status"] == "completed"
    assert t["champion_id"] is not None


def test_swiss():
    _reset()
    ids = _make_players(6)
    r = client.post("/api/tournaments", json={"name": "Swiss", "format": "swiss", "player_ids": ids})
    tid = r.json()["id"]
    _play_all(tid)
    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    rounds = {m["round_number"] for m in matches}
    assert len(rounds) == 3
    assert all(m["played"] for m in matches)


def test_champions_league():
    _reset()
    ids = _make_players(8)
    r = client.post(
        "/api/tournaments",
        json={
            "name": "CL",
            "format": "champions_league",
            "player_ids": ids,
            "settings": {"qualifiers": 4},
        },
    )
    tid = r.json()["id"]
    _play_all(tid)
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["status"] == "completed"
    assert t["champion_id"] is not None


def test_knockout_draw_requires_penalties():
    _reset()
    ids = _make_players(2)
    tid = client.post(
        "/api/tournaments", json={"name": "Final", "format": "knockout", "player_ids": ids}
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    bad = client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result", json={"home_score": 1, "away_score": 1}
    )
    assert bad.status_code == 400
    good = client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result",
        json={"home_score": 1, "away_score": 1, "home_pen": 4, "away_pen": 3},
    )
    assert good.status_code == 200


def test_player_stats():
    _reset()
    ids = _make_players(4)
    tid = client.post(
        "/api/tournaments",
        json={"name": "Stats", "format": "league", "player_ids": ids},
    ).json()["id"]
    _play_all(tid)
    r = client.get(f"/api/players/{ids[0]}/stats")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["totals"]["tournaments"] == 1
    assert data["totals"]["played"] == 3  # 4-player round robin
    assert data["totals"]["won"] + data["totals"]["drawn"] + data["totals"]["lost"] == 3
    assert data["history"][0]["rank"] is not None
    assert data["history"][0]["tournament_id"] == tid

    listing = client.get("/api/players").json()
    row = next(x for x in listing if x["id"] == ids[0])
    assert row["tournaments"] == 1


def test_auto_rating():
    _reset()
    ids = _make_players(2)
    tid = client.post(
        "/api/tournaments", json={"name": "R", "format": "league", "player_ids": ids}
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result",
        json={"home_score": 3, "away_score": 0},
    )
    listing = client.get("/api/players").json()
    winner = next(x for x in listing if x["id"] == m["home_id"])
    loser = next(x for x in listing if x["id"] == m["away_id"])
    assert winner["elo"] > 1000 > loser["elo"]
    assert winner["rating"] > 50 > loser["rating"]

    stats = client.get(f"/api/players/{winner['id']}/stats").json()
    assert stats["totals"]["rating"] == winner["rating"]
    assert stats["totals"]["elo"] == winner["elo"]


def test_double_round_league():
    _reset()
    ids = _make_players(4)
    tid = client.post(
        "/api/tournaments",
        json={
            "name": "Home & Away",
            "format": "league",
            "player_ids": ids,
            "settings": {"double_round": True},
        },
    ).json()["id"]
    matches = client.get(f"/api/tournaments/{tid}/matches").json()
    assert len(matches) == 12  # 4 players x 3 opponents x 2 legs
    from collections import Counter

    unordered = Counter(frozenset((m["home_id"], m["away_id"])) for m in matches)
    assert len(unordered) == 6 and all(v == 2 for v in unordered.values())
    ordered = Counter((m["home_id"], m["away_id"]) for m in matches)
    assert len(ordered) == 12 and all(v == 1 for v in ordered.values())


def test_games():
    _reset()
    ids = _make_players(3)
    r = client.post(
        "/api/games",
        json={"home_id": ids[0], "away_id": ids[1], "home_score": 2, "away_score": 1},
    )
    assert r.status_code == 201, r.text
    games = client.get("/api/games").json()
    assert len(games) == 1
    assert games[0]["home_name"] and games[0]["away_name"]

    # Games count toward career stats and ratings.
    stats = client.get(f"/api/players/{ids[0]}/stats").json()
    assert stats["totals"]["played"] == 1
    assert any(h["format"] == "friendly" for h in stats["history"])

    listing = client.get("/api/players").json()
    winner = next(x for x in listing if x["id"] == ids[0])
    loser = next(x for x in listing if x["id"] == ids[1])
    assert winner["elo"] > 1000 > loser["elo"]

    # Same player can't play themselves.
    bad = client.post(
        "/api/games",
        json={"home_id": ids[0], "away_id": ids[0], "home_score": 1, "away_score": 0},
    )
    assert bad.status_code == 400

    assert client.delete(f"/api/games/{games[0]['id']}").status_code == 204
    assert client.get("/api/games").json() == []


def test_league_auto_completes():
    _reset()
    ids = _make_players(2)
    tid = client.post(
        "/api/tournaments", json={"name": "Auto", "format": "league", "player_ids": ids}
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result",
        json={"home_score": 2, "away_score": 1},
    )
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["status"] == "completed"
    assert t["champion_id"] == m["home_id"]


def test_stats_with_dates_and_games():
    # Regression: imported tournaments have real dates; friendlies have none.
    _reset()
    ids = _make_players(2)
    tid = client.post(
        "/api/tournaments",
        json={
            "name": "Dated",
            "format": "league",
            "player_ids": ids,
            "start_date": "2020-05-05",
        },
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result",
        json={"home_score": 1, "away_score": 0},
    )
    client.post(
        "/api/games",
        json={"home_id": ids[0], "away_id": ids[1], "home_score": 2, "away_score": 2},
    )
    r = client.get(f"/api/players/{ids[0]}/stats")
    assert r.status_code == 200, r.text
    assert any(h["format"] == "friendly" for h in r.json()["history"])


def test_close_tournament():
    _reset()
    ids = _make_players(4)
    tid = client.post(
        "/api/tournaments", json={"name": "Manual", "format": "league", "player_ids": ids}
    ).json()["id"]
    assert client.get(f"/api/tournaments/{tid}").json()["status"] == "active"
    r = client.post(f"/api/tournaments/{tid}/close")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"

    # Renaming works too.
    ren = client.patch(f"/api/tournaments/{tid}", json={"name": "Renamed"})
    assert ren.status_code == 200
    assert ren.json()["name"] == "Renamed"


def test_tournament_note():
    _reset()
    ids = _make_players(2)
    t = client.post(
        "/api/tournaments",
        json={"name": "N", "format": "league", "player_ids": ids, "note": "FIFA 24"},
    ).json()
    assert t["note"] == "FIFA 24"
    r = client.patch(f"/api/tournaments/{t['id']}", json={"note": "Rocket League"})
    assert r.status_code == 200
    assert r.json()["note"] == "Rocket League"


def test_backup_export():
    _reset()
    r = client.get("/api/export/backup")
    assert r.status_code == 200
    assert r.content[:16] == b"SQLite format 3\x00"
    assert "attachment" in r.headers.get("content-disposition", "")


def test_import_synthetic(tmp_path):
    _reset()
    src = tmp_path / "export.sqlite"
    con = sqlite3.connect(src)
    con.executescript(
        """
        CREATE TABLE joueur (pseudo TEXT, email TEXT, picture TEXT, note INTEGER);
        CREATE TABLE tournoi (idTournoi INTEGER, nomTournoi TEXT, nbJoueurs INTEGER, dateDebut TEXT, dateFin TEXT, termine INTEGER, poulesTermine INTEGER);
        CREATE TABLE matches (idMatch INTEGER, idTournoi INTEGER, idPoule INTEGER, date TEXT, numTour INTEGER,
            idJoueur1 TEXT, idJoueur2 TEXT, scoreJ1 INTEGER, scoreJ2 INTEGER, nomGagnant TEXT, saisi INTEGER,
            numTv INTEGER, gagnantMatch1 INTEGER, gagnantMatch2 INTEGER, numMatch INTEGER, tabJ1 INTEGER,
            tabJ2 INTEGER, note TEXT, perdantMatch1 INTEGER, perdantMatch2 INTEGER);
        CREATE TABLE champion (idTournoi INTEGER, nomJoueur TEXT);
        CREATE TABLE configuration (idTournoi INTEGER, idTypeTournoi INTEGER);
        INSERT INTO joueur VALUES ('Alice','','',70),('Bob','','',60);
        INSERT INTO tournoi VALUES (1,'Old League',2,'2016-01-01 00:00:00','2016-01-02 00:00:00',1,1);
        INSERT INTO configuration VALUES (1,1);
        INSERT INTO matches VALUES (1,1,1,'2016-01-01 00:00:00',1,'Alice','Bob',3,0,'Alice',1,1,NULL,NULL,NULL,-1,-1,NULL,NULL,NULL);
        INSERT INTO champion VALUES (1,'Alice');
        """
    )
    con.commit()
    con.close()

    with open(src, "rb") as f:
        resp = client.post("/api/import/legacy", files={"file": ("export.sqlite", f, "application/octet-stream")})
    assert resp.status_code == 200, resp.text
    stats = resp.json()
    assert stats["tournaments"] == 1
    assert stats["matches"] == 1
    tours = client.get("/api/tournaments").json()
    assert tours[0]["name"] == "Old League"
    assert tours[0]["status"] == "completed"
    assert tours[0]["start_date"] == "2016-01-01"
    assert tours[0]["created_at"].startswith("2016-01-01")
