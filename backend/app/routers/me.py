from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import hash_password, verify_password
from app.database.connection import get_db
from app.database.models import User


router = APIRouter(tags=["me"])


class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr | None
    role: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None


class UpdateMeRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=50)
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=500)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        role=getattr(current_user, "role", None),
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
    )


@router.patch("/me", response_model=UserResponse)
def update_me(
    payload: UpdateMeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.username is not None:
        current_user.username = payload.username.strip()
    if payload.email is not None:
        current_user.email = str(payload.email).lower() if payload.email else None
    if payload.display_name is not None:
        current_user.display_name = payload.display_name
    if payload.avatar_url is not None:
        current_user.avatar_url = payload.avatar_url

    try:
        db.add(current_user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists") from None

    db.refresh(current_user)
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        role=getattr(current_user, "role", None),
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
    )


@router.post("/me/change-password", status_code=204)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=422, detail="New password must be different")

    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)
    db.commit()
    return None

