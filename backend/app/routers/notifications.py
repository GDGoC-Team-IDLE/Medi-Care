
import logging
import re
from datetime import date, datetime
from hmac import compare_digest
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.config import get_settings
from app.core.database import get_db
from app.medication_notifications import (
    EVENT_TYPE,
    TITLE,
    deliver_medication_low,
    depletion_date,
    notification_body,
    queue_medication_low,
)
from app.models import Guardian, Patient, Prescription

logger = logging.getLogger(__name__)
internal_bearer = HTTPBearer(
    auto_error=False, scheme_name="InternalBearer", description="내부 알림 호출용 토큰"
)
ERRORS = {
    400: ("INVALID_REQUEST", "약 소진 알림 요청 정보가 올바르지 않습니다."),
    401: ("UNAUTHORIZED", "인증되지 않은 요청입니다."),
    404: ("PRESCRIPTION_NOT_FOUND", "처방전 또는 보호자 정보를 찾을 수 없습니다."),
    500: ("INTERNAL_SERVER_ERROR", "약 소진 알림 처리 중 오류가 발생했습니다."),
}


def _error(status_code: int) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        {"success": False, "error": {"code": code, "message": message}},
        status_code=status_code,
        headers={"WWW-Authenticate": "Bearer"} if status_code == 401 else None,
    )


class NotificationRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError:
                return _error(400)
            except HTTPException as exc:
                if exc.status_code == 400:
                    return _error(400)
                raise
            except Exception:
                logger.exception("Could not queue medication notification")
                return _error(500)

        return handle


router = APIRouter(tags=["notifications"], route_class=NotificationRoute)
PositiveId = Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]


class MedicationLowRequest(BaseModel):
    patient_id: PositiveId
    prescription_id: PositiveId
    event_type: Literal["MEDICATION_LOW"]
    source: Literal["APSCHEDULER"]
    depletion_date: date
    days_remaining: Annotated[int, Field(strict=True, ge=0, le=3)]
    detected_at: AwareDatetime

    @field_validator("depletion_date", mode="before")
    @classmethod
    def validate_date(cls, value: object) -> object:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Expected YYYY-MM-DD")
        return value

    @field_validator("detected_at", mode="before")
    @classmethod
    def validate_detected_at(cls, value: object) -> datetime:
        if not isinstance(value, str):
            raise ValueError("Expected an ISO 8601 timestamp with offset")
        return datetime.fromisoformat(value)


@router.post(
    "/notifications/guardian/",
    status_code=202,
    responses={
        200: {"description": "이미 접수한 처방 알림"},
        400: {"description": "잘못된 알림 요청"},
        401: {"description": "내부 토큰 인증 실패"},
        404: {"description": "처방전 또는 보호자 없음"},
        500: {"description": "알림 처리 오류"},
    },
)
def notify_guardian(
    data: MedicationLowRequest,
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials | None = Depends(internal_bearer),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    secret = settings.internal_token
    if not secret or credentials is None or not compare_digest(
        credentials.credentials.encode(), secret.encode()
    ):
        return _error(401)

    prescription = db.scalar(
        select(Prescription)
        .join(Patient, Patient.id == Prescription.patient_id)
        .join(Guardian, Guardian.id == Patient.guardian_id)
        .where(Prescription.id == data.prescription_id, Patient.id == data.patient_id)
    )
    if prescription is None:
        return _error(404)

    timezone = ZoneInfo(settings.timezone)
    detected_at = data.detected_at.astimezone(timezone)
    if prescription.days <= 0:
        return _error(400)
    run_out_on = depletion_date(prescription)
    remaining = (run_out_on - detected_at.date()).days
    if run_out_on != data.depletion_date or remaining != data.days_remaining:
        return _error(400)

    notification, created = queue_medication_low(
        db, data.prescription_id, run_out_on, remaining, detected_at.replace(tzinfo=None)
    )
    if notification.status == "QUEUED":
        background_tasks.add_task(deliver_medication_low, notification.id)

    common = {
        "patient_id": data.patient_id,
        "prescription_id": data.prescription_id,
        "event_type": EVENT_TYPE,
    }
    if not created:
        return JSONResponse({
            "success": True,
            "data": {**common, "status": "ALREADY_SENT", "message": "이미 약 소진 알림이 전송되었습니다."},
        }, status_code=200, background=background_tasks)

    return {
        "success": True,
        "data": {
            "notification_id": notification.id,
            **common,
            "depletion_date": run_out_on,
            "days_remaining": remaining,
            "title": TITLE,
            "body": notification_body(remaining),
            "status": "QUEUED",
            "created_at": notification.created_at.replace(tzinfo=timezone),
        },
    }
=======
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

