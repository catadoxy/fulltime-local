import os
import tempfile
from pathlib import Path

# Point the app at a throwaway SQLite file BEFORE the app is imported.
_db = Path(tempfile.gettempdir()) / "ftl_test.db"
if _db.exists():
    _db.unlink()
os.environ["FTL_DATABASE_URL"] = f"sqlite:///{_db}"
os.environ["FTL_FRONTEND_DIR"] = str(Path(tempfile.gettempdir()) / "ftl_no_frontend")
