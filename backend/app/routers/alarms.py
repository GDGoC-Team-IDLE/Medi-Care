from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.enums import AlarmMode, Slot
from app.models import AlarmSetting, Patient
from app.routers.auth import bearer, get_guardian_auth
from app.security import token_hash

router = APIRouter(prefix="/patients", tags=["alarms"])


class AlarmSettingItem(BaseModel):
    slot: Slot
    mode: AlarmMode


class AlarmSettingsUpdate(BaseModel):
    settings: list[AlarmSettingItem] = Field(min_length=1, max_length=len(Slot))


def _not_found() -> HTTPException:
    return HTTPException(
        status.HTTP_404_NOT_FOUND,
        "어르신 프로필을 찾을 수 없습니다.",
    )


def _resolve_guardian_patient(
    patient_id: int,
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> Patient:
    auth = get_guardian_auth(credentials, db)
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise _not_found()
    if patient.guardian_id != auth.guardian_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "이 어르신의 알림 설정에 접근할 권한이 없습니다.",
        )
    return patient


def _resolve_device_patient(x_device_token: str | None, db: Session) -> Patient:
    if not x_device_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "기기 토큰이 필요합니다.")

    patient = db.scalar(
        select(Patient).where(Patient.device_token == token_hash(x_device_token))
    )
    if patient is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "등록되지 않은 기기입니다.")
    return patient


def _settings_response(patient: Patient, db: Session) -> dict:
    saved = {
        setting.slot: setting.mode
        for setting in db.scalars(
            select(AlarmSetting).where(AlarmSetting.patient_id == patient.id)
        ).all()
    }
    return {
        "patient_id": patient.id,
        "settings": [
            {
                "slot": slot.value,
                "mode": saved.get(slot, AlarmMode.POPUP).value,
            }
            for slot in Slot
        ],
    }


@router.get("/{patient_id}/alarm-settings")
def get_alarm_settings(
    patient_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    x_device_token: str | None = Header(default=None, alias="X-Device-Token"),
    db: Session = Depends(get_db),
):
    if patient_id == "me":
        patient = _resolve_device_patient(x_device_token, db)
    else:
        try:
            numeric_patient_id = int(patient_id)
        except ValueError:
            raise _not_found() from None
        patient = _resolve_guardian_patient(numeric_patient_id, credentials, db)

    return _settings_response(patient, db)


@router.patch("/{patient_id}/alarm-settings")
def update_alarm_settings(
    patient_id: int,
    data: AlarmSettingsUpdate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    patient = _resolve_guardian_patient(patient_id, credentials, db)

    requested_slots = [item.slot for item in data.settings]
    if len(requested_slots) != len(set(requested_slots)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "같은 복용 회차를 두 번 설정할 수 없습니다.",
        )

    existing = {
        setting.slot: setting
        for setting in db.scalars(
            select(AlarmSetting).where(AlarmSetting.patient_id == patient.id)
        ).all()
    }
    for item in data.settings:
        setting = existing.get(item.slot)
        if setting is None:
            db.add(
                AlarmSetting(
                    patient_id=patient.id,
                    slot=item.slot,
                    mode=item.mode,
                )
            )
        else:
            setting.mode = item.mode

    db.commit()
    return _settings_response(patient, db)
