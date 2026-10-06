"""Application configuration.

All values can be overridden with environment variables so the container can be
configured without rebuilding the image.
"""
import os
from pathlib import Path

# Directory where the SQLite file lives. Mounted as a volume in Docker.
DATA_DIR = Path(os.environ.get("FTL_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.environ.get("FTL_DATABASE_URL", f"sqlite:///{DATA_DIR / 'fulltime.db'}")

# Folder containing the built React app (served by FastAPI in production).
FRONTEND_DIR = Path(
    os.environ.get("FTL_FRONTEND_DIR", Path(__file__).resolve().parent.parent.parent / "frontend" / "dist")
)

APP_NAME = "FullTime Local"
APP_VERSION = "0.4.0"
