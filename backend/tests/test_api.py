import sqlite3

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import AppSetting, FootballTeam, Participant

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
    listing = client.get("/api/tournaments").json()
    assert listing[0]["players"] == 6
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
    assert data["tournaments"]["totals"]["tournaments"] == 1
    assert data["tournaments"]["totals"]["played"] == 3  # 4-player round robin
    assert (
        data["tournaments"]["totals"]["won"]
        + data["tournaments"]["totals"]["drawn"]
        + data["tournaments"]["totals"]["lost"]
        == 3
    )
    assert data["tournaments"]["history"][0]["rank"] is not None
    assert data["tournaments"]["history"][0]["tournament_id"] == tid

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
    assert stats["rating"]["rating"] == winner["rating"]
    assert stats["rating"]["elo"] == winner["elo"]


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
    db = SessionLocal()
    try:
        db.add(FootballTeam(
            id=64, name="Liverpool FC", short_name="Liverpool", crest_url="https://example.test/liverpool.png",
            competition_code="PL", competition_name="Premier League",
        ))
        db.commit()
    finally:
        db.close()
    r = client.post(
        "/api/games",
        json={
            "home_id": ids[0], "away_id": ids[1], "home_team_id": 64,
            "home_score": 2, "away_score": 1,
        },
    )
    assert r.status_code == 201, r.text
    games = client.get("/api/games").json()
    assert len(games) == 1
    assert games[0]["home_name"] and games[0]["away_name"]
    assert games[0]["home_team"]["name"] == "Liverpool FC"
    assert games[0]["home_team"]["crest_url"] == "https://example.test/liverpool.png"

    # Games count toward friendly stats and friendly Elo (but not tournament Elo).
    w_stats = client.get(f"/api/players/{ids[0]}/stats").json()
    l_stats = client.get(f"/api/players/{ids[1]}/stats").json()
    assert w_stats["friendlies"]["totals"]["played"] == 1
    assert w_stats["friendlies"]["matches"][0]["result"] in ("W", "D", "L")
    assert w_stats["friendly_rating"]["elo"] > 1000 > l_stats["friendly_rating"]["elo"]

    listing = client.get("/api/players").json()
    w = next(x for x in listing if x["id"] == ids[0])
    assert w["elo"] == 1000  # tournament Elo is unaffected by friendlies

    # Same player can't play themselves.
    bad = client.post(
        "/api/games",
        json={"home_id": ids[0], "away_id": ids[0], "home_score": 1, "away_score": 0},
    )
    assert bad.status_code == 400

    assert client.delete(f"/api/games/{games[0]['id']}").status_code == 204
    assert client.get("/api/games").json() == []


def test_meta_suggests_existing_game_names():
    _reset()
    ids = _make_players(2)
    client.post("/api/tournaments", json={
        "name": "FIFA event", "format": "league", "player_ids": ids, "note": "FIFA 27",
    })
    client.post("/api/tournaments", json={
        "name": "PES event", "format": "league", "player_ids": ids, "note": "PES",
    })
    client.post("/api/games", json={
        "home_id": ids[0], "away_id": ids[1], "home_score": 1, "away_score": 0,
        "note": " fifa 27 ",
    })
    client.post("/api/games", json={
        "home_id": ids[1], "away_id": ids[0], "home_score": 1, "away_score": 0,
        "note": "Rocket League",
    })

    assert client.get("/api/meta").json()["game_tags"] == ["FIFA 27", "PES", "Rocket League"]


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
    assert r.json()["friendlies"]["matches"]


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
        json={"name": "N", "format": "league", "player_ids": ids, "note": "FIFA 24", "start_date": "2014-05-01"},
    ).json()
    assert t["note"] == "FIFA 24"
    assert t["start_date"] == "2014-05-01"
    r = client.patch(
        f"/api/tournaments/{t['id']}", json={"note": "Rocket League", "start_date": "2013-01-01"}
    )
    assert r.status_code == 200
    assert r.json()["note"] == "Rocket League"
    assert r.json()["start_date"] == "2013-01-01"


def test_compare():
    _reset()
    ids = _make_players(2)
    tid = client.post(
        "/api/tournaments", json={"name": "C", "format": "league", "player_ids": ids}
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result",
        json={"home_score": 2, "away_score": 1},
    )
    client.post(
        "/api/games",
        json={"home_id": ids[0], "away_id": ids[1], "home_score": 0, "away_score": 3},
    )

    r = client.get(f"/api/compare?a={ids[0]}&b={ids[1]}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["a"]["player"]["id"] == ids[0]
    assert d["b"]["player"]["id"] == ids[1]
    h = d["head_to_head"]
    assert h["played"] == 2  # one tournament match + one friendly
    assert h["a_wins"] + h["b_wins"] + h["draws"] == h["played"]

    assert client.get(f"/api/compare?a={ids[0]}&b={ids[0]}").status_code == 400


def test_player_real_name():
    _reset()
    p = client.post("/api/players", json={"name": "nick", "real_name": "Real Name"}).json()
    assert p["real_name"] == "Real Name"
    r = client.patch(f"/api/players/{p['id']}", json={"real_name": "New Name"})
    assert r.status_code == 200
    assert r.json()["real_name"] == "New Name"
    assert client.get("/api/players").json()[0]["real_name"] == "New Name"


def test_fulltime_import_rejects_non_sqlite():
    _reset()
    resp = client.post(
        "/api/import/fulltime",
        files={"file": ("export.db", b"not a sqlite database at all", "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_fulltime_backup_import_merge_dedup_and_replace():
    _reset()
    ids = _make_players(2)
    tournament = client.post(
        "/api/tournaments", json={"name": "Backup league", "format": "league", "player_ids": ids}
    ).json()
    match = client.get(f"/api/tournaments/{tournament['id']}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tournament['id']}/matches/{match['id']}/result",
        json={"home_score": 2, "away_score": 1},
    )
    client.post("/api/games", json={
        "home_id": ids[0], "away_id": ids[1], "home_score": 1, "away_score": 0,
        "played_at": "2026-11-10", "note": "Friendly backup",
    })

    db = SessionLocal()
    try:
        db.add(FootballTeam(
            id=64, name="Liverpool FC", short_name="Liverpool", crest_url="https://example.test/liverpool.png",
            competition_code="PL", competition_name="Premier League",
        ))
        participant = db.execute(
            select(Participant).where(
                Participant.tournament_id == tournament["id"], Participant.player_id == ids[0]
            )
        ).scalar_one()
        participant.team_id = 64
        db.commit()
    finally:
        db.close()

    backup = client.get("/api/export/backup")
    assert backup.status_code == 200
    assert backup.content.startswith(b"SQLite format 3\x00")

    _reset()
    db = SessionLocal()
    try:
        db.add(AppSetting(key="installation-setting", value="keep-current"))
        db.commit()
    finally:
        db.close()
    existing_player_id = client.post("/api/players", json={"name": "P1"}).json()["id"]
    keep_id = client.post("/api/players", json={"name": "Keep me during merge"}).json()["id"]

    preview = client.post(
        "/api/import/fulltime/preview",
        files={"file": ("fulltime-backup.db", backup.content, "application/octet-stream")},
    )
    assert preview.status_code == 200, preview.text
    preview_data = preview.json()
    assert preview_data["backup"] == {
        "players": 2, "tournaments": 1, "matches": 1, "friendlies": 1, "teams": 1,
    }
    assert preview_data["players"] == 1
    assert preview_data["reused_players"] == 1
    assert len(client.get("/api/tournaments").json()) == 0
    assert len(client.get("/api/games").json()) == 0
    assert {p["id"] for p in client.get("/api/players").json()} == {existing_player_id, keep_id}

    first = client.post(
        "/api/import/fulltime",
        files={"file": ("fulltime-backup.db", backup.content, "application/octet-stream")},
    )
    assert first.status_code == 200, first.text
    assert first.json()["tournaments"] == 1
    assert first.json()["matches"] == 1
    assert first.json()["games"] == 1
    assert any(p["id"] == keep_id for p in client.get("/api/players").json())
    imported = client.get("/api/tournaments").json()
    assert len(imported) == 1 and imported[0]["name"] == "Backup league"
    detail = client.get(f"/api/tournaments/{imported[0]['id']}").json()
    assert next(p for p in detail["participants"] if p["player"]["name"] == "P1")["team"]["crest_url"] == "https://example.test/liverpool.png"

    # Re-importing the same backup doesn't duplicate its tournament or friendly.
    second = client.post(
        "/api/import/fulltime",
        files={"file": ("fulltime-backup.db", backup.content, "application/octet-stream")},
    )
    assert second.status_code == 200, second.text
    assert second.json()["duplicates"] == 2
    assert len(client.get("/api/tournaments").json()) == 1
    assert len(client.get("/api/games").json()) == 1

    # Replace removes tournament data but restores the uploaded backup cleanly.
    third = client.post(
        "/api/import/fulltime",
        files={"file": ("fulltime-backup.db", backup.content, "application/octet-stream")},
        data={"replace": "true"},
    )
    assert third.status_code == 200, third.text
    assert third.json()["replaced"] is True
    assert {p["name"] for p in client.get("/api/players").json()} == {"P1", "P2"}
    assert len(client.get("/api/games").json()) == 1
    db = SessionLocal()
    try:
        assert db.get(AppSetting, "installation-setting").value == "keep-current"
    finally:
        db.close()


def test_tournament_list_sorted_by_date():
    _reset()
    ids = _make_players(2)
    # "Newer" created first, "Older" created second (so its created_at is later).
    client.post("/api/tournaments", json={"name": "Newer", "format": "league", "player_ids": ids, "start_date": "2024-01-01"})
    client.post("/api/tournaments", json={"name": "Older", "format": "league", "player_ids": ids, "start_date": "2014-01-01"})
    names = [t["name"] for t in client.get("/api/tournaments").json()]
    assert names.index("Newer") < names.index("Older")


def test_champion_updates_after_edit():
    _reset()
    ids = _make_players(2)
    tid = client.post(
        "/api/tournaments", json={"name": "L", "format": "league", "player_ids": ids}
    ).json()["id"]
    m = client.get(f"/api/tournaments/{tid}/matches").json()[0]

    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result", json={"home_score": 2, "away_score": 0}
    )
    assert client.get(f"/api/tournaments/{tid}").json()["champion_id"] == m["home_id"]

    # Completed tournaments are read-only; reopen before editing.
    assert client.post(f"/api/tournaments/{tid}/reopen").status_code == 200
    client.post(
        f"/api/tournaments/{tid}/matches/{m['id']}/result", json={"home_score": 0, "away_score": 2}
    )
    # Still open because it was reopened manually.
    assert client.get(f"/api/tournaments/{tid}").json()["status"] == "active"
    client.post(f"/api/tournaments/{tid}/close")

    # Closing recomputes the champion from the edited result.
    assert client.get(f"/api/tournaments/{tid}").json()["champion_id"] == m["away_id"]


def test_backup_export():
    _reset()
    r = client.get("/api/export/backup")
    assert r.status_code == 200
    assert r.content[:16] == b"SQLite format 3\x00"
    assert "attachment" in r.headers.get("content-disposition", "")


def test_fulltime_import_rejects_other_sqlite_schema(tmp_path):
    _reset()
    src = tmp_path / "not-fulltime.sqlite"
    con = sqlite3.connect(src)
    con.execute("CREATE TABLE unrelated_data (value TEXT)")
    con.commit()
    con.close()

    with open(src, "rb") as f:
        resp = client.post(
            "/api/import/fulltime", files={"file": ("not-fulltime.sqlite", f, "application/octet-stream")}
        )
    assert resp.status_code == 400
    assert "FullTime Local backup" in resp.json()["detail"]


def test_roster_edits_rebuild_fixtures_safely():
    _reset()
    ids = _make_players(4)
    tid = client.post(
        "/api/tournaments", json={"name": "Editable roster", "format": "league", "player_ids": ids[:3]}
    ).json()["id"]

    add_player = client.put(
        f"/api/tournaments/{tid}/participants",
        json={"player_ids": ids, "participant_teams": {}},
    )
    assert add_player.status_code == 200, add_player.text
    assert len(add_player.json()["participants"]) == 4
    assert len(client.get(f"/api/tournaments/{tid}/matches").json()) == 6

    matches_before_edit = client.get(f"/api/tournaments/{tid}/matches").json()
    match = next(
        item for item in matches_before_edit
        if {item["home_id"], item["away_id"]} == {ids[0], ids[1]}
    )
    client.post(
        f"/api/tournaments/{tid}/matches/{match['id']}/result",
        json={"home_score": 2, "away_score": 1},
    )
    blocked = client.put(
        f"/api/tournaments/{tid}/participants",
        json={"player_ids": ids[:3], "participant_teams": {}},
    )
    assert blocked.status_code == 400
    assert "confirmation" in blocked.json()["detail"]

    rebuilt = client.put(
        f"/api/tournaments/{tid}/participants",
        json={"player_ids": ids[:3], "participant_teams": {}, "confirm_rebuild": True},
    )
    assert rebuilt.status_code == 200, rebuilt.text
    assert len(rebuilt.json()["participants"]) == 3
    rebuilt_matches = client.get(f"/api/tournaments/{tid}/matches").json()
    assert len(rebuilt_matches) == 3
    preserved = next(
        item for item in rebuilt_matches
        if {item["home_id"], item["away_id"]} == {ids[0], ids[1]}
    )
    expected_scores = (2, 1) if preserved["home_id"] == match["home_id"] else (1, 2)
    assert preserved["played"] is True
    assert (preserved["home_score"], preserved["away_score"]) == expected_scores
    assert sum(item["played"] for item in rebuilt_matches) == 1

    assert client.post(f"/api/tournaments/{tid}/close").status_code == 200
    closed_edit = client.put(
        f"/api/tournaments/{tid}/participants",
        json={"player_ids": ids, "participant_teams": {}},
    )
    assert closed_edit.status_code == 400


def test_roster_team_only_edit_preserves_existing_results():
    _reset()
    ids = _make_players(2)
    db = SessionLocal()
    try:
        db.add(FootballTeam(
            id=64, name="Liverpool FC", short_name="Liverpool", crest_url="https://example.test/liverpool.png",
            competition_code="PL", competition_name="Premier League",
        ))
        db.commit()
    finally:
        db.close()

    tournament = client.post(
        "/api/tournaments",
        json={
            "name": "Club change only",
            "format": "league",
            "player_ids": ids,
            "participant_teams": {str(ids[0]): 64},
        },
    ).json()
    match = client.get(f"/api/tournaments/{tournament['id']}/matches").json()[0]
    client.post(
        f"/api/tournaments/{tournament['id']}/matches/{match['id']}/result",
        json={"home_score": 1, "away_score": 0},
    )
    assert client.post(f"/api/tournaments/{tournament['id']}/reopen").status_code == 200

    updated = client.put(
        f"/api/tournaments/{tournament['id']}/participants",
        json={"player_ids": ids, "participant_teams": {str(ids[1]): 64}},
    )
    assert updated.status_code == 200, updated.text
    fixture = client.get(f"/api/tournaments/{tournament['id']}/matches").json()[0]
    assert fixture["played"] is True
    assert (fixture["home_score"], fixture["away_score"]) == (1, 0)
    participant_teams = {p["player_id"]: p["team"] for p in updated.json()["participants"]}
    assert participant_teams[ids[0]] is None
    assert participant_teams[ids[1]]["id"] == 64
