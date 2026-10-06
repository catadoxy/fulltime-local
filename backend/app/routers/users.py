"""Admin-only user management."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import VALID_ROLES, hash_password, require_admin
from ..database import get_db
from ..models import User

router = APIRouter(prefix="/api/users", tags=["users"])


def _out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "role": u.role, "created_at": u.created_at}


@router.get("")
def list_users(request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    users = db.execute(select(User).order_by(User.username)).scalars().all()
    return [_out(u) for u in users]


@router.post("", status_code=201)
def create_user(payload: dict, request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    role = str(payload.get("role") or "viewer")
    if not username:
        raise HTTPException(400, "Username is required")
    if len(password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Role must be one of {VALID_ROLES}")
    if db.execute(select(User).where(User.username == username)).scalar_one_or_none():
        raise HTTPException(409, "Username already taken")
    user = User(username=username, password_hash=hash_password(password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _out(user)


@router.patch("/{user_id}")
def update_user(user_id: int, payload: dict, request: Request, db: Session = Depends(get_db)):
    me = require_admin(request, db)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if "role" in payload and payload["role"] is not None:
        role = str(payload["role"])
        if role not in VALID_ROLES:
            raise HTTPException(400, f"Role must be one of {VALID_ROLES}")
        if user.role == "admin" and role != "admin":
            admins = (
                db.execute(select(func.count()).select_from(User).where(User.role == "admin")).scalar()
                or 0
            )
            if admins <= 1:
                raise HTTPException(400, "Cannot demote the last admin")
        user.role = role
    if payload.get("password"):
        if len(str(payload["password"])) < 4:
            raise HTTPException(400, "Password must be at least 4 characters")
        user.password_hash = hash_password(str(payload["password"]))
    db.commit()
    db.refresh(user)
    return _out(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    me = require_admin(request, db)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if isinstance(me, str) is False and me.id == user.id:
        raise HTTPException(400, "Cannot delete your own account")
    if user.role == "admin":
        admins = (
            db.execute(select(func.count()).select_from(User).where(User.role == "admin")).scalar()
            or 0
        )
        if admins <= 1:
            raise HTTPException(400, "Cannot delete the last admin")
    db.delete(user)
    db.commit()
