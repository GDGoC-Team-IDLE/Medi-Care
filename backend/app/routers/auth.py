import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.models import Guardian, RefreshToken, RevokedAccessToken
from app.security import (
    REFRESH_TOKEN_DAYS,
    create_access_token,
    hash_password,
    token_hash,
    verify_access_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)


class SignupRequest(BaseModel):
    user_email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    user_nickname: str = Field(min_length=1, max_length=50)


class LoginRequest(BaseModel):
    user_email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class DeleteAccountRequest(BaseModel):
    password: str


@dataclass(frozen=True)
class GuardianAuth:
    guardian_id: int
    access_token: str
    access_expires_at: datetime


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _issue_refresh_token(db: Session, guardian_id: int) -> str:
    raw_token = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            guardian_id=guardian_id,
            token_hash=token_hash(raw_token),
            expires_at=now_local() + timedelta(days=REFRESH_TOKEN_DAYS),
        )
    )
    return raw_token


def get_guardian_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> GuardianAuth:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("보호자 인증이 필요합니다.")

    access_token = credentials.credentials
    try:
        payload = verify_access_token(access_token)
    except ValueError:
        raise _unauthorized("유효하지 않은 JWT입니다.") from None

    access_hash = token_hash(access_token)
    revoked = db.get(RevokedAccessToken, access_hash)
    if revoked is not None:
        if revoked.expires_at > now_local():
            raise _unauthorized("로그아웃된 JWT입니다.")
        db.delete(revoked)
        db.commit()

    if db.get(Guardian, payload.guardian_id) is None:
        raise _unauthorized("탈퇴했거나 존재하지 않는 사용자입니다.")

    return GuardianAuth(
        guardian_id=payload.guardian_id,
        access_token=access_token,
        access_expires_at=payload.expires_at,
    )


def get_guardian_id(auth: GuardianAuth = Depends(get_guardian_auth)) -> int:
    return auth.guardian_id


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(data: SignupRequest, db: Session = Depends(get_db)):
    email = str(data.user_email).lower()
    if db.scalar(select(Guardian).where(Guardian.email == email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다.")

    guardian = Guardian(
        email=email,
        password_hash=hash_password(data.password),
        name=data.user_nickname,
    )
    db.add(guardian)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다.") from None
    db.refresh(guardian)
    return {"status": "success", "user_id": guardian.id}


@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    email = str(data.user_email).lower()
    guardian = db.scalar(select(Guardian).where(Guardian.email == email))
    if guardian is None or not verify_password(data.password, guardian.password_hash):
        raise _unauthorized("이메일 또는 비밀번호가 일치하지 않습니다.")

    access_token = create_access_token(guardian.id)
    refresh_token = _issue_refresh_token(db, guardian.id)
    db.commit()
    return {
        "status": "success",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user_nickname": guardian.name,
    }


@router.post("/refresh")
def refresh(data: RefreshRequest, db: Session = Depends(get_db)):
    refresh_hash = token_hash(data.refresh_token)
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == refresh_hash))
    if record is None or record.expires_at < now_local():
        if record is not None:
            db.delete(record)
            db.commit()
        raise _unauthorized("Refresh Token이 유효하지 않습니다.")

    guardian_id = record.guardian_id
    access_token = create_access_token(guardian_id)
    db.delete(record)
    new_refresh_token = _issue_refresh_token(db, guardian_id)
    db.commit()
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.post("/logout")
def logout(
    data: LogoutRequest,
    auth: GuardianAuth = Depends(get_guardian_auth),
    db: Session = Depends(get_db),
):
    db.add(
        RevokedAccessToken(
            token_hash=token_hash(auth.access_token),
            expires_at=auth.access_expires_at,
        )
    )
    refresh_record = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash(data.refresh_token),
            RefreshToken.guardian_id == auth.guardian_id,
        )
    )
    if refresh_record is not None:
        db.delete(refresh_record)
    db.commit()
    return {"status": "success", "message": "로그아웃되었습니다."}


@router.delete("/user")
def delete_account(
    data: DeleteAccountRequest,
    auth: GuardianAuth = Depends(get_guardian_auth),
    db: Session = Depends(get_db),
):
    guardian = db.get(Guardian, auth.guardian_id)
    if guardian is None:
        raise _unauthorized("탈퇴했거나 존재하지 않는 사용자입니다.")
    if not verify_password(data.password, guardian.password_hash):
        raise _unauthorized("비밀번호가 일치하지 않습니다.")

    db.add(
        RevokedAccessToken(
            token_hash=token_hash(auth.access_token),
            expires_at=auth.access_expires_at,
        )
    )
    db.delete(guardian)
    db.commit()
    return {"status": "success", "message": "회원 탈퇴가 완료되었습니다."}
