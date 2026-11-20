import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.core.photo_storage import sign_dose_photos
from app.dose_schedule import list_scheduled_doses
from app.enums import DoseStatus, Slot
from app.models import Patient
from app.routers.auth import bearer, get_guardian_auth

router = APIRouter(tags=["guardian doses"])
logger = logging.getLogger(__name__)
NO_STORE = {"Cache-Control": "no-store"}
ERRORS = {
    401: ("UNAUTHORIZED", "로그인이 필요합니다."),
    403: ("FORBIDDEN", "해당 환자의 복약 정보를 조회할 권한이 없습니다."),
    404: ("PATIENT_NOT_FOUND", "환자 정보를 찾을 수 없습니다."),
    500: ("INTERNAL_SERVER_ERROR", "복약 정보를 불러오는 중 오류가 발생했습니다."),
}
ROUND_NAMES = {
    Slot.MORNING: "아침",
    Slot.LUNCH: "점심",
    Slot.DINNER: "저녁",
    Slot.BEDTIME: "취침 전",
}
RoundStatus = Literal["COMPLETED", "MISSED", "INCORRECT", "SCHEDULED"]
ROUND_STATUSES: dict[DoseStatus, RoundStatus] = {
    DoseStatus.DONE: "COMPLETED",
    DoseStatus.MISSED: "MISSED",
    DoseStatus.WRONG: "INCORRECT",
    DoseStatus.PENDING: "SCHEDULED",
}


@dataclass(frozen=True)
class DoseRound:
    round_id: int
    round_name: str
    scheduled_at: str
    status: RoundStatus
    verified_at: datetime | None
    photo_url: str | None


@dataclass(frozen=True)
class TodayDoses:
    patient_id: int
    date: date
    rounds: list[DoseRound]


@dataclass(frozen=True)
class TodayDosesResponse:
    success: Literal[True]
    data: TodayDoses


@dataclass(frozen=True)
class ErrorDetail:
    code: str
    message: str


@dataclass(frozen=True)
class ErrorResponse:
    success: Literal[False]
    error: ErrorDetail


def _error(status_code: int) -> JSONResponse:
    code, message = ERRORS[status_code]
    headers = {**NO_STORE, "WWW-Authenticate": "Bearer"} if status_code == 401 else NO_STORE
    return JSONResponse(
        content={"success": False, "error": {"code": code, "message": message}},
        status_code=status_code,
        headers=headers,
    )


@router.get(
    "/guardian/patients/{patient_id}/doses/today/",
    response_model=TodayDosesResponse,
    responses={code: {"model": ErrorResponse} for code in ERRORS},
)
def get_today_doses(
    patient_id: int,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        auth = get_guardian_auth(credentials, db)
        patient = db.get(Patient, patient_id) if 1 <= patient_id <= 2_147_483_647 else None
        if patient is None:
            return _error(404)
        if patient.guardian_id != auth.guardian_id:
            return _error(403)

        today = now_local().date()
        doses = list_scheduled_doses(db, patient_id, today)
        urls = sign_dose_photos(dose.photo_path for dose in doses if dose.photo_path)
        rounds = [
            DoseRound(
                round_id=dose.slot_id,
                round_name=ROUND_NAMES[dose.slot],
                scheduled_at=dose.scheduled_at.strftime("%H:%M"),
                status=ROUND_STATUSES[dose.status],
                verified_at=dose.taken_at,
                photo_url=urls.get(dose.photo_path) if dose.photo_path else None,
            )
            for dose in doses
        ]
        response.headers.update(NO_STORE)
        return TodayDosesResponse(success=True, data=TodayDoses(patient_id, today, rounds))
    except HTTPException as exc:
        if exc.status_code == 401:
            return _error(401)
        logger.exception("Unexpected guardian dose HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not load today's guardian doses")
        return _error(500)
