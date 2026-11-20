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
