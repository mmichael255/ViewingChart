from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.security import create_access_token, hash_password, verify_password
from app.database.connection import get_db
from app.database.models import User, Watchlist


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=72)
    email: EmailStr | None = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    user = User(
        username=payload.username.strip(),
        email=str(payload.email).lower() if payload.email else None,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    try:
        db.flush()  # ensure user.id exists before watchlist
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists") from None

    # Create an initial default watchlist.
    wl = Watchlist(user_id=user.id, name="My Watchlist", is_default=True)
    db.add(wl)
    db.commit()

    token = create_access_token(subject=str(user.id), extra_claims={"username": user.username})
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    token = create_access_token(subject=str(user.id), extra_claims={"username": user.username})
    return TokenResponse(access_token=token)

