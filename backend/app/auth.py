"""User accounts with admin / viewer roles.

Two modes:

* **Open mode** (default): no ``FTL_PASSWORD`` set and no users exist —
  everything is accessible, no login required (previous behaviour).
* **Secured mode**: enabled as soon as ``FTL_PASSWORD`` is set or at least
  one user exists. ``admin`` can do everything; ``viewer`` is read-only.

Passwords are PBKDF2-HMAC-SHA256 hashes (stdlib only, 200k iterations).
Sessions are stateless HMAC-signed cookies
``<user_id>:<expiry>:<signature>`` bound to the password hash, so changing
a password invalidates existing sessions. The legacy single shared-password
(``FTL_PASSWORD`` with zero users) still works as an admin fallback.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import DATA_DIR
from .database import get_db

PASSWORD = os.environ.get("FTL_PASSWORD") or None
LEGACY_ENABLED = bool(PASSWORD)
COOKIE_NAME = "ftl_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

VALID_ROLES = ("admin", "viewer")


def _secret() -> bytes:
    env = os.environ.get("FTL_SECRET")
    if env:
        return env.encode("utf-8")
    key_file = DATA_DIR / "secret.key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
    return key_file.read_text().strip().encode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return f"pbkdf2-sha256$200000${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, hexdk = stored.split("$")
        if algo != "pbkdf2-sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hexdk)
    except Exception:
        return False


def _sign(user_id: int, expiry: int, pw_hash: str) -> str:
    msg = f"{user_id}:{expiry}:{pw_hash}".encode("utf-8")
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()


def _issue_cookie(response: Response, request: Request, user_id: int, pw_hash: str) -> None:
    expiry = int(time.time()) + SESSION_MAX_AGE
    sig = _sign(user_id, expiry, pw_hash)
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(
        COOKIE_NAME,
        f"{user_id}:{expiry}:{sig}",
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=SESSION_MAX_AGE,
    )


def _legacy_token() -> str:
    message = f"fulltime-local:{PASSWORD}".encode("utf-8")
    return hmac.new(_secret(), message, hashlib.sha256).hexdigest()


def _is_legacy_session(request: Request) -> bool:
    if not LEGACY_ENABLED:
        return False
    value = request.cookies.get(COOKIE_NAME)
    return bool(value) and hmac.compare_digest(value, _legacy_token())


def auth_required_db(db: Session) -> bool:
    """Auth is required when a legacy password is set or any user exists."""
    if LEGACY_ENABLED:
        return True
    from .models import User

    count = db.execute(select(func.count()).select_from(User)).scalar() or 0
    return count > 0


def get_current_user(request: Request, db: Session):
    """Return the logged-in User, the string ``"legacy"`` for the old shared
    password session, or ``None``."""
    from .models import User

    if _is_legacy_session(request):
        return "legacy"
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or ":" not in raw:
        return None
    try:
        user_id_s, expiry_s, sig = raw.split(":", 2)
        user_id, expiry = int(user_id_s), int(expiry_s)
    except ValueError:
        return None
    if expiry < time.time():
        return None
    user = db.get(User, user_id)
    if not user:
        return None
    if not hmac.compare_digest(sig, _sign(user.id, expiry, user.password_hash)):
        return None
    return user


def is_admin(principal) -> bool:
    return principal == "legacy" or (principal is not None and principal != "legacy" and principal.role == "admin")


def is_authenticated(request: Request, db: Session | None = None) -> bool:
    """Backwards-compatible check used by middleware/tests without a DB."""
    if _is_legacy_session(request):
        return True
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or ":" not in raw:
        # No DB available: fall back to legacy-only behaviour.
        if db is None:
            return not LEGACY_ENABLED and False or False
        return get_current_user(request, db) is not None
    if db is None:
        return False
    return get_current_user(request, db) is not None


def require_admin(request: Request, db: Session):
    principal = get_current_user(request, db)
    if principal is None:
        raise HTTPException(401, "Not authenticated")
    if not is_admin(principal):
        raise HTTPException(403, "Admin role required")
    return principal


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str | None = None
    password: str = Field(min_length=1)


class SetupIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=4, max_length=200)


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=4, max_length=200)
    role: str = Field(default="viewer")


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    from .models import User

    user_count = db.execute(select(func.count()).select_from(User)).scalar() or 0
    required = LEGACY_ENABLED or user_count > 0
    principal = get_current_user(request, db) if required else None
    user = None
    if principal == "legacy":
        user = {"id": 0, "username": "admin", "role": "admin", "legacy": True}
    elif principal is not None:
        user = {"id": principal.id, "username": principal.username, "role": principal.role}
    return {
        "auth_required": required,
        "authenticated": principal is not None if required else True,
        "setup_required": user_count == 0 and not LEGACY_ENABLED,
        "user_count": user_count,
        "user": user,
    }


@router.post("/setup")
def setup(payload: SetupIn, response: Response, request: Request, db: Session = Depends(get_db)):
    """Create the first admin account. Only works when no users exist."""
    from .models import User

    count = db.execute(select(func.count()).select_from(User)).scalar() or 0
    if count > 0:
        raise HTTPException(403, "Setup already completed")
    username = payload.username.strip()
    if not username:
        raise HTTPException(400, "Username is required")
    exists = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Username already taken")
    user = User(username=username, password_hash=hash_password(payload.password), role="admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    _issue_cookie(response, request, user.id, user.password_hash)
    return {"ok": True, "user": {"id": user.id, "username": user.username, "role": user.role}}


@router.post("/login")
def login(payload: LoginIn, response: Response, request: Request, db: Session = Depends(get_db)):
    from .models import User

    user_count = db.execute(select(func.count()).select_from(User)).scalar() or 0
    if user_count == 0 and not LEGACY_ENABLED:
        return {"ok": True, "auth_required": False}

    # Legacy shared-password login (no users yet).
    if user_count == 0 and LEGACY_ENABLED and (payload.username or "").strip() in ("", "admin"):
        if not hmac.compare_digest(payload.password, PASSWORD or ""):
            raise HTTPException(401, "Incorrect password")
        is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        response.set_cookie(
            COOKIE_NAME, _legacy_token(), httponly=True, samesite="lax",
            secure=is_https, max_age=SESSION_MAX_AGE,
        )
        return {"ok": True, "user": {"username": "admin", "role": "admin", "legacy": True}}

    if not payload.username:
        raise HTTPException(400, "Username is required")
    user = db.execute(select(User).where(User.username == payload.username.strip())).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Incorrect username or password")
    _issue_cookie(response, request, user.id, user.password_hash)
    return {"ok": True, "user": {"id": user.id, "username": user.username, "role": user.role}}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    principal = get_current_user(request, db)
    if principal is None:
        raise HTTPException(401, "Not authenticated")
    if principal == "legacy":
        return {"id": 0, "username": "admin", "role": "admin", "legacy": True}
    return {"id": principal.id, "username": principal.username, "role": principal.role}
