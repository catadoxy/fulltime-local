from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .config import APP_NAME, APP_VERSION, FRONTEND_DIR
from .database import Base, engine
from .routers import games, imports, players, tournaments

app = FastAPI(title=APP_NAME, version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local app; tighten if you expose it
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


@app.on_event("startup")
def _startup() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate()
    from .database import SessionLocal
    from .services.results import complete_finished_tournaments

    with SessionLocal() as db:
        complete_finished_tournaments(db)


app.include_router(auth.router)
app.include_router(players.router)
app.include_router(tournaments.router)
app.include_router(games.router)
app.include_router(imports.router)


@app.middleware("http")
async def _auth_guard(request, call_next):
    if auth.AUTH_ENABLED:
        path = request.url.path
        protected = (
            path.startswith("/api")
            and not path.startswith("/api/auth")
            and path != "/api/health"
        )
        if protected and not auth.is_authenticated(request):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


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
