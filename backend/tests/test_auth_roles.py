"""Admin / viewer roles: viewer is read-only, admin can manage users."""
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_setup_and_roles():
    _reset()

    # Open mode: no auth required, setup offered.
    s = client.get("/api/auth/status").json()
    assert s["auth_required"] is False
    assert s["setup_required"] is True

    # Bootstrap the first admin (no auth needed yet).
    r = client.post("/api/auth/setup", json={"username": "boss", "password": "secret123"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "admin"

    # Setup cannot run twice.
    assert client.post("/api/auth/setup", json={"username": "x", "password": "yyyy"}).status_code == 403

    # Now auth is required.
    s2 = client.get("/api/auth/status").json()
    assert s2["auth_required"] is True

    admin = TestClient(app)
    admin.post("/api/auth/login", json={"username": "boss", "password": "secret123"})

    # Admin creates a viewer.
    v = admin.post("/api/users", json={"username": "guest", "password": "view1234", "role": "viewer"})
    assert v.status_code == 201, v.text

    viewer = TestClient(app)
    assert viewer.post("/api/auth/login", json={"username": "guest", "password": "view1234"}).status_code == 200

    # Viewer can read but not write.
    assert viewer.get("/api/players").status_code == 200
    assert viewer.post("/api/players", json={"name": "Nope"}).status_code == 403
    assert viewer.get("/api/tournaments").status_code == 200
    assert viewer.post("/api/tournaments", json={"name": "Nope"}).status_code == 403

    # Admin can write and manage users.
    assert admin.post("/api/players", json={"name": "Yes"}).status_code == 201
    users = admin.get("/api/users").json()
    assert {u["username"] for u in users} == {"boss", "guest"}
    assert viewer.get("/api/users").status_code == 403

    # Cannot delete or demote the last admin.
    guest_id = next(u["id"] for u in users if u["username"] == "guest")
    boss_id = next(u["id"] for u in users if u["username"] == "boss")
    assert admin.delete(f"/api/users/{boss_id}").status_code == 400
    assert admin.patch(f"/api/users/{boss_id}", json={"role": "viewer"}).status_code == 400
    assert admin.delete(f"/api/users/{guest_id}").status_code == 204

    # Wrong password rejected.
    bad = TestClient(app)
    assert bad.post("/api/auth/login", json={"username": "boss", "password": "wrong"}).status_code == 401

    # Unauthenticated blocked once users exist.
    anon = TestClient(app)
    assert anon.get("/api/players").status_code == 401
