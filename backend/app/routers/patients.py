import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.models import PairAttempt, PairingCode, Patient
from app.routers.auth import get_guardian_id
from app.security import token_hash

router = APIRouter(tags=["patients"])


class PatientRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class PairRequest(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/patients", status_code=status.HTTP_201_CREATED)
def create_patient(
    data: PatientRequest,
    guardian_id: int = Depends(get_guardian_id),
    db: Session = Depends(get_db),
):
    patient = Patient(name=data.name, guardian_id=guardian_id, device_token=None)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return {"patient_id": patient.id, "name": patient.name}


@router.post("/patients/{patient_id}/pairing-code")
def create_pairing_code(
    patient_id: int,
    guardian_id: int = Depends(get_guardian_id),
    db: Session = Depends(get_db),
):
    patient = db.scalar(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.guardian_id == guardian_id,
        )
    )
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "어르신 프로필을 찾을 수 없습니다.")

    old_code = db.scalar(select(PairingCode).where(PairingCode.patient_id == patient_id))
    if old_code is not None:
        db.delete(old_code)
        db.flush()

    code = f"{secrets.randbelow(1_000_000):06d}"
    while db.get(PairingCode, code) is not None:
        code = f"{secrets.randbelow(1_000_000):06d}"

    db.add(
        PairingCode(
            code=code,
            patient_id=patient_id,
            expires_at=now_local() + timedelta(minutes=5),
        )
    )
    db.commit()
    return {"pairing_code": code, "expires_in_seconds": 300}


@router.post("/devices/pair")
def pair_device(data: PairRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    now = now_local()
    cutoff = now - timedelta(minutes=5)

    db.execute(delete(PairAttempt).where(PairAttempt.attempted_at < cutoff))
    recent_count = db.scalar(
        select(func.count())
        .select_from(PairAttempt)
        .where(PairAttempt.client_ip == client_ip, PairAttempt.attempted_at >= cutoff)
    )
    if (recent_count or 0) >= 5:
        db.commit()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "입력 횟수를 초과했습니다.")

    db.add(PairAttempt(client_ip=client_ip, attempted_at=now))
    pairing = db.get(PairingCode, data.code)
    if pairing is None or pairing.expires_at < now:
        if pairing is not None:
            db.delete(pairing)
        db.commit()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "연결 코드가 잘못되었거나 만료되었습니다.",
        )

    patient = db.get(Patient, pairing.patient_id)
    if patient is None:
        db.delete(pairing)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "연결 코드가 유효하지 않습니다.")

    raw_device_token = secrets.token_urlsafe(48)
    patient.device_token = token_hash(raw_device_token)
    patient_id = patient.id
    db.delete(pairing)
    db.commit()
    return {
        "status": "success",
        "patient_id": patient_id,
        "device_token": raw_device_token,
    }


def get_device_patient(device_token: str | None, db: Session) -> Patient:
    if not device_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "기기 토큰이 필요합니다.")

    patient = db.scalar(
        select(Patient).where(Patient.device_token == token_hash(device_token))
    )
    if patient is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "등록되지 않은 기기입니다.")
    return patient


@router.get("/patient/me")
def patient_me(
    x_device_token: str | None = Header(default=None, alias="X-Device-Token"),
    db: Session = Depends(get_db),
):
    patient = get_device_patient(x_device_token, db)
    return {
        "patient_id": patient.id,
        "name": patient.name,
        "guardian_id": patient.guardian_id,
    }
