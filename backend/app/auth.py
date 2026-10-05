"""Optional single shared-password auth.

Disabled unless the ``FTL_PASSWORD`` environment variable is set. When enabled,
a signed (HMAC) session cookie is issued on login and the ``/api`` routes require
it. Intended to protect the app when it is reachable beyond your own machine —
it is not a user-account system.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .config import DATA_DIR

PASSWORD = os.environ.get("FTL_PASSWORD") or None
AUTH_ENABLED = bool(PASSWORD)
COOKIE_NAME = "ftl_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def _secret() -> bytes:
    env = os.environ.get("FTL_SECRET")
    if env:
        return env.encode("utf-8")
    key_file = DATA_DIR / "secret.key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
    return key_file.read_text().strip().encode("utf-8")


def _token() -> str:
    # Salt with the password so changing it invalidates existing sessions.
    message = f"fulltime-local:{PASSWORD}".encode("utf-8")
    return hmac.new(_secret(), message, hashlib.sha256).hexdigest()


def is_authenticated(request: Request) -> bool:
    if not AUTH_ENABLED:
        return True
    value = request.cookies.get(COOKIE_NAME)
    return bool(value) and hmac.compare_digest(value, _token())


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    password: str


@router.get("/status")
def status(request: Request):
    return {"auth_required": AUTH_ENABLED, "authenticated": is_authenticated(request)}


@router.post("/login")
def login(payload: LoginIn, response: Response):
    if not AUTH_ENABLED:
        return {"ok": True, "auth_required": False}
    if not hmac.compare_digest(payload.password, PASSWORD or ""):
        raise HTTPException(401, "Incorrect password")
    response.set_cookie(
        COOKIE_NAME,
        _token(),
        httponly=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}
