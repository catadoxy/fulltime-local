# FullTime Local

A self-hosted, browser-based tournament manager for friend game nights. Runs
locally (Docker or bare Python) and can import history from a legacy encrypted
database export.

Built with **FastAPI + SQLite** (backend, `Room`-free clean schema) and a
**React + Vite + TypeScript** single-page app, served from a single container.

---

## Features

- **5 tournament formats**
  - Championship / round-robin (single or home-and-away)
  - Knockout (with byes and an optional third-place match)
  - Group stage + finals
  - Swiss system (auto-paired each round)
  - Champions League (league phase → knockout)
- **Fair auto-scheduling** across a limited number of **pitches / TVs**, with
  rest between a player's own games.
- **Result entry** with automatic standings, knockout advancement, bracket view
  and champion detection.
- **Player management** and per-player ratings.
- **Tournament notes** — record which game you played (FIFA, Rocket League…).
- **Themes** — Floodlights, Midnight, Terrace, and a light Programme theme.
- **Games tab** — record one-off / friendly matches outside any tournament; they
  count toward each player's stats and rating.
- **Optional password** — set `FTL_PASSWORD` to require a shared login.
- **Import a legacy database** — upload an original encrypted
  `*_database_*.db` export *or* a decrypted `.sqlite`. It decrypts
  automatically and preserves historical tournaments, matches and champions.
- **Docker-ready**, single port, data persisted on a mounted volume.

---

## Quick start (Docker)

> Requires Docker with the Compose plugin.

The image is published to GitHub Container Registry, so you can run it **without
cloning the repo** — just grab `docker-compose.yml` and:

```bash
docker compose up -d
```

Then open <http://localhost:8756>.

If the package is **private** (the default), log in to the registry first using a
GitHub Personal Access Token with the `read:packages` scope:

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u catadoxy --password-stdin
```

### Build from source instead

```bash
git clone https://github.com/catadoxy/fulltime-local.git
cd fulltime-local
docker compose -f docker-compose.build.yml up --build
```

- The SQLite database lives in `./data/fulltime.db` on the host (mounted volume).
- Interactive API docs: <http://localhost:8756/docs>

To stop: `docker compose down` (the DB is a bind mount and is not removed).

---

## Releases &amp; images

The image is published to GitHub Container Registry by
`.github/workflows/docker-publish.yml`:

- Every push to `main` publishes `ghcr.io/catadoxy/fulltime-local:latest` plus a
  `sha-…` tag.
- Pushing a version tag publishes semver tags **and** creates a GitHub Release:

  ```bash
  git tag v0.2.0
  git push origin v0.2.0
  # -> ghcr.io/catadoxy/fulltime-local:0.2.0, :0.2, :0  + a GitHub Release
  ```

Pin a specific version in production by changing the compose image to e.g.
`ghcr.io/catadoxy/fulltime-local:0.2.0`. `latest` follows `main`.

---

## Local development

Two processes: the API and the Vite dev server (which proxies `/api`).

**Backend**

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8756
```

**Frontend**

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8756` (see `vite.config.ts`).

**Production-style (single port)** — build the SPA and let FastAPI serve it:

```bash
cd frontend && npm run build
cd ../backend
# Windows (PowerShell)
$env:FTL_FRONTEND_DIR="../frontend/dist"; uvicorn app.main:app --port 8756
```

---

## Player ratings

Ratings are **calculated automatically** from results — there is nothing to set
by hand. They use an **Elo** system (the chess/tennis method), which accounts for
*who* you beat, not just how often:

- Everyone starts at **1000 Elo**.
- After a match: `expected = 1 / (1 + 10^((opponent − you)/400))`, then
  `you += K × (actual − expected)` (`actual` = 1 win / 0.5 draw / 0 loss).
- `K` is higher for provisional players (<10 matches → 40; <30 → 24; else 16),
  so early results move quickly and it settles over time.
- A mild margin-of-victory bonus is applied (`1 + min(goalDiff, 4) × 0.125`).
- Penalty shoot-outs count as draws.

The familiar **0–100** figure is derived as `round(50 + (elo − 1000) / 8)`:
1000 → 50, 1200 → 75, 800 → 25. Elo is shown alongside it on a player's profile.
Ratings are recomputed from your full match history on every request, so they are
always consistent with the recorded results.

---

## Importing your existing data

1. Open **Data** in the app.
2. Upload either:
   - an original encrypted export `<name>_database_<timestamp>.db`, or
   - the decrypted `.sqlite` file.
3. Historical tournaments are added as `completed`, with players, matches and
   champions preserved.

The decryption routine (AES-256/ECB with a key derived from the source app's
package name) is also available standalone:

```bash
python decrypt_export.py "export.db"
# -> writes export_decrypted.sqlite
```

---

## Configuration

All optional, via environment variables:

| Variable             | Default                    | Purpose                                  |
| -------------------- | -------------------------- | ---------------------------------------- |
| `FTL_DATA_DIR`       | `backend/data`             | Directory holding the SQLite file        |
| `FTL_DATABASE_URL`   | `sqlite:///<DATA_DIR>/fulltime.db` | Override the DB URL entirely    |
| `FTL_FRONTEND_DIR`   | `frontend/dist`            | Where the built SPA is served from       |
| `FTL_PASSWORD`       | *(unset)*                  | If set, require this shared password to log in |
| `FTL_SECRET`         | auto (file in data dir)    | Signing key for the session cookie       |

---

## Testing

```bash
cd backend
python -m pytest -q
```

Covers fixture generation for every format, scheduling pitch/slot limits,
standings, knockout progression (incl. byes and penalty shoot-outs), Swiss
round generation, and the legacy importer.

---

## Project layout

```
backend/
  app/
    main.py            FastAPI app + SPA serving
    database.py        SQLAlchemy engine/session
    models.py          Player, Tournament, Group, Participant, Match
    schemas.py         Pydantic request/response models
    serializers.py     ORM -> API dicts
    legacy_import.py   Legacy import (decrypts encrypted exports too)
    engine/            pure algorithms: round_robin, knockout, swiss, scheduling
    services/          fixtures (creation), standings, results (progression)
    routers/           players, tournaments, meta/import
  tests/               pytest suite
frontend/
  src/
    pages/             Tournaments, TournamentDetail, Players, Import
    api.ts, types.ts   typed API client
Dockerfile             multi-stage (Node build -> Python runtime)
docker-compose.yml
```

---

## Notes / possible next steps

- Match simulator using player ratings (the schema already stores `rating`).
- Independent "pitches"/venue management (the scheduler already supports N).
- Two-legged knockout ties.
- Authentication if you ever expose it beyond your LAN (currently no auth;
  intended for local/friends use).
