from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    # bcrypt only uses the first 72 bytes of the password; passlib raises on longer inputs.
    # Enforce this explicitly to avoid accidental truncation or 500s.
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Password is too long (bcrypt max is 72 bytes).",
        )
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    return pwd_context.verify(plain_password, password_hash)


def _require_jwt_secret() -> str:
    if not settings.JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth is not configured (missing JWT_SECRET).",
        )
    return settings.JWT_SECRET


def create_access_token(*, subject: str, extra_claims: dict[str, Any] | None = None) -> str:
    secret = _require_jwt_secret()
    now = datetime.now(tz=timezone.utc)
    exp = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRES_MINUTES)

    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, secret, algorithm=settings.JWT_ALG)


def decode_token(token: str) -> dict[str, Any]:
    secret = _require_jwt_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.JWT_ALG])
        if not isinstance(payload, dict):
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token") from None

