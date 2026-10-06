from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .config import APP_NAME, APP_VERSION, FRONTEND_DIR
from .database import Base, SessionLocal, engine
from .routers import compare, games, imports, players, tournaments, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate()
    # NOTE: no silent data mutation on startup. Previously this called
    # complete_finished_tournaments() + reconcile_champions() on every boot,
    # which could flip tournament status without an explicit user action.
    # Use POST /api/tournaments/{id}/close or the reconcile service instead.
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Same-origin in production (SPA is served by FastAPI).
    # Only allow the Vite dev server cross-origin during development.
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _migrate() -> None:
    """Tiny forward-only migrations for existing SQLite databases."""
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tournaments)")}
        if cols and "note" not in cols:
            conn.exec_driver_sql("ALTER TABLE tournaments ADD COLUMN note VARCHAR(300)")
        pcols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(players)")}
        if pcols and "real_name" not in pcols:
            conn.exec_driver_sql("ALTER TABLE players ADD COLUMN real_name VARCHAR(120)")


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(players.router)
app.include_router(tournaments.router)
app.include_router(games.router)
app.include_router(compare.router)
app.include_router(imports.router)


@app.middleware("http")
async def _auth_guard(request, call_next):
    from .models import User

    path = request.url.path
    if path.startswith("/api/auth") or path == "/api/health":
        return await call_next(request)
    if not path.startswith("/api"):
        return await call_next(request)

    # Auth is required when a legacy password is set or any user exists.
    # Open the session here (middleware runs outside Depends(get_db)).
    db = SessionLocal()
    try:
        required = auth.auth_required_db(db)
        if not required:
            return await call_next(request)
        principal = auth.get_current_user(request, db)
        if principal is None:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        # Viewers are read-only: only GET/HEAD/OPTIONS.
        if not auth.is_admin(principal) and request.method not in ("GET", "HEAD", "OPTIONS"):
            return JSONResponse({"detail": "Viewer role is read-only"}, status_code=403)
    finally:
        db.close()
    return await call_next(request)


# ---- Serve the built React SPA (production / Docker) ---------------------- #
if FRONTEND_DIR.exists():
    assets = FRONTEND_DIR / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = FRONTEND_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = FRONTEND_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return HTMLResponse("<h1>FullTime Local</h1><p>Frontend build not found.</p>", status_code=200)
else:
    @app.get("/", include_in_schema=False)
    def root():
        return HTMLResponse(
            "<h1>FullTime Local API</h1>"
            "<p>Frontend not built. Run the Vite dev server, or build the frontend.</p>"
            "<p>API docs: <a href='/docs'>/docs</a></p>"
        )
