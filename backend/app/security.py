import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash

from app.core.config import get_settings

ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 30
REFRESH_TOKEN_DAYS = 7
password_hasher = PasswordHash.recommended()


@dataclass(frozen=True)
class AccessTokenPayload:
    guardian_id: int
    expires_at: datetime


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return password_hasher.verify(password, hashed)
    except (TypeError, ValueError):
        return False


def _jwt_secret() -> str:
    secret = get_settings().jwt_secret
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET을 32자 이상의 무작위 문자열로 설정해야 합니다.")
    return secret


def create_access_token(guardian_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(guardian_id),
        "role": "guardian",
        "type": "access",
        "jti": secrets.token_urlsafe(16),
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=ALGORITHM)


def verify_access_token(token: str) -> AccessTokenPayload:
    try:
        payload = jwt.decode(
            token,
            _jwt_secret(),
            algorithms=[ALGORITHM],
            options={"require": ["sub", "iat", "exp"]},
        )
        if payload.get("type") != "access" or payload.get("role") != "guardian":
            raise ValueError("invalid token claims")

        guardian_id = int(payload["sub"])
        expires_utc = datetime.fromtimestamp(int(payload["exp"]), timezone.utc)
        local_tz = ZoneInfo(get_settings().timezone)
        expires_local = expires_utc.astimezone(local_tz).replace(tzinfo=None)
        return AccessTokenPayload(guardian_id=guardian_id, expires_at=expires_local)
    except (InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid or expired token") from exc
