import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.enums import DoseStatus, GuardianAlertType, Slot
from app.models import DoseSlot, GuardianAlert, Patient, PushToken
from app.routers.auth import get_guardian_id
from app.routers.patients import get_device_patient
from app.services.expo_push import ExpoPushError, send_expo_push

router = APIRouter(tags=["notifications"])

EXPO_TOKEN_RE = re.compile(r"^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$")
SLOT_LABELS = {
    Slot.MORNING: "아침",
    Slot.LUNCH: "점심",
    Slot.DINNER: "저녁",
    Slot.BEDTIME: "취침 전",
}


class PushTokenRequest(BaseModel):
    expo_token: str = Field(max_length=255)


def _alert_response(alert: GuardianAlert, *, tokens: int, sent: int, duplicate: bool) -> dict:
    return {
        "alert_id": alert.id,
        "type": alert.type.value,
        "patient_id": alert.patient_id,
        "slot_id": alert.dose_slot_id,
        "created_at": alert.created_at,
        "duplicate": duplicate,
        "push": {
            "registered_tokens": tokens,
            "accepted": sent,
            "status": "SENT" if alert.push_sent_at else "PENDING",
        },
    }


@router.post("/push-tokens")
def register_push_token(
    data: PushTokenRequest,
    guardian_id: int = Depends(get_guardian_id),
    db: Session = Depends(get_db),
):
    if EXPO_TOKEN_RE.fullmatch(data.expo_token) is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_PUSH_TOKEN",
                "message": "알림 토큰 형식이 올바르지 않아요.",
            },
        )

    token = db.scalar(select(PushToken).where(PushToken.expo_token == data.expo_token))
    if token is None:
        token = PushToken(guardian_id=guardian_id, expo_token=data.expo_token)
        db.add(token)
    else:
        token.guardian_id = guardian_id
    db.commit()
    db.refresh(token)
    return {
        "push_token_id": token.id,
        "expo_token": token.expo_token,
        "message": "알림 받을 준비가 됐어요.",
    }


@router.post("/patients/me/dose-slots/{slot_id}/no-response")
def report_no_response(
    slot_id: int,
    patient: Patient = Depends(get_device_patient),
    db: Session = Depends(get_db),
):
    """15분 로컬 알림까지 반응이 없을 때 어르신 기기가 한 번 호출합니다."""

    dose_slot = db.get(DoseSlot, slot_id)
    if dose_slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "복용 회차를 찾을 수 없습니다.")
    if dose_slot.patient_id != patient.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 복용 회차에 접근할 수 없습니다.")
    if dose_slot.status != DoseStatus.PENDING:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "이미 처리된 복용 회차입니다.",
        )

    alert_type = GuardianAlertType.DOSE_NO_RESPONSE
    existing = db.scalar(
        select(GuardianAlert).where(
            GuardianAlert.dose_slot_id == dose_slot.id,
            GuardianAlert.type == alert_type,
        )
    )
    duplicate = existing is not None
    if existing is None:
        slot_label = SLOT_LABELS[dose_slot.slot]
        existing = GuardianAlert(
            guardian_id=patient.guardian_id,
            patient_id=patient.id,
            dose_slot_id=dose_slot.id,
            type=alert_type,
            title="복약 확인이 필요해요",
            body=f"{patient.name}님이 {slot_label} 약 알림에 15분 동안 반응하지 않았어요.",
        )
        db.add(existing)
        try:
            db.commit()
        except IntegrityError:
            # 두 요청이 동시에 들어와도 알림 행은 하나만 남깁니다.
            db.rollback()
            existing = db.scalar(
                select(GuardianAlert).where(
                    GuardianAlert.dose_slot_id == dose_slot.id,
                    GuardianAlert.type == alert_type,
                )
            )
            if existing is None:
                raise
            duplicate = True
        else:
            db.refresh(existing)

    tokens = db.scalars(
        select(PushToken).where(PushToken.guardian_id == patient.guardian_id)
    ).all()
    sent = 0
    if existing.push_sent_at is None and tokens:
        try:
            result = send_expo_push(
                [token.expo_token for token in tokens],
                title=existing.title,
                body=existing.body,
                data={
                    "type": existing.type.value,
                    "alert_id": existing.id,
                    "patient_id": patient.id,
                    "slot_id": dose_slot.id,
                    "route": "/guardian/g02-missed",
                },
            )
            sent = result.accepted
            if result.invalid_tokens:
                for token in tokens:
                    if token.expo_token in result.invalid_tokens:
                        db.delete(token)
            existing.push_error = ", ".join(result.errors)[:500] or None
            if sent > 0:
                existing.push_sent_at = now_local()
            db.commit()
        except ExpoPushError as exc:
            existing.push_error = str(exc)[:500]
            db.commit()

    return _alert_response(
        existing,
        tokens=len(tokens),
        sent=sent,
        duplicate=duplicate,
    )
