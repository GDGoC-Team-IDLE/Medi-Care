import logging
import re
from collections import Counter
from collections.abc import Mapping
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.core.photo_storage import sign_dose_photos
from app.dose_schedule import list_scheduled_doses
from app.enums import DoseStatus, Slot, VerifyResult
from app.models import Patient
from app.routers.auth import bearer, get_guardian_auth
from app.routers.patients import get_device_patient

logger = logging.getLogger(__name__)
router = APIRouter(tags=["dose status"])
device_header = APIKeyHeader(name="X-Device-Token", auto_error=False)

ERRORS = {
    400: ("INVALID_DATE", "조회 날짜가 올바르지 않습니다. 2026-11-20 형식으로 보내 주세요."),
    401: ("UNAUTHORIZED", "로그인이 필요합니다."),
    403: ("FORBIDDEN", "복약 정보를 조회할 권한이 없습니다."),
    404: ("PATIENT_NOT_FOUND", "복용자 정보를 찾을 수 없습니다."),
    500: ("INTERNAL_ERROR", "오늘의 복약 정보를 불러오는 중 오류가 발생했습니다."),
}
SLOT_NAMES = {
    Slot.MORNING: "아침",
    Slot.LUNCH: "점심",
    Slot.DINNER: "저녁",
    Slot.BEDTIME: "취침 전",
}
VOICE_BY_STATUS = {
    DoseStatus.DONE: "드셨어요.",
    DoseStatus.PENDING: "아직 안 드셨어요.",
    DoseStatus.MISSED: "복용 기록이 없어요.",
    DoseStatus.WRONG: "인증 결과를 확인해 주세요.",
}
DUPLICATE_WARNING = "이미 드신 약이에요"
NO_STORE = {"Cache-Control": "no-store"}


class StatusError(BaseModel):
    code: str
    message: str


class StatusSummary(BaseModel):
    total: int
    done: int
    pending: int
    missed: int
    wrong: int


class StatusSlot(BaseModel):
    slot_id: int
    slot: Slot
    scheduled_at: datetime
    expected_count: int
    status: DoseStatus
    result: VerifyResult | None
    taken_at: datetime | None
    photo_url: str | None
    can_verify: bool
    duplicate_warning: str | None


class PatientStatus(BaseModel):
    patient_id: int
    patient_name: str
    date: date
    voice_message: str
    summary: StatusSummary
    slots: list[StatusSlot]


def _resolve_patient(
    patient_id: str,
    device_token: str | None,
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> Patient:
    if patient_id == "me" and device_token:
        return get_device_patient(device_token, db)

    if credentials is None:
        if device_token:
            get_device_patient(device_token, db)
            raise HTTPException(403)
        raise HTTPException(401)

    auth = get_guardian_auth(credentials, db)
    if patient_id == "me":
        raise HTTPException(403)

    if not re.fullmatch(r"[0-9]{1,10}", patient_id):
        raise HTTPException(404)
    numeric_id = int(patient_id)
    if not 1 <= numeric_id <= 2_147_483_647:
        raise HTTPException(404)

    patient = db.get(Patient, numeric_id)
    if patient is None:
        raise HTTPException(404)
    if patient.guardian_id != auth.guardian_id:
        raise HTTPException(403)
    return patient


def _parse_date(value: str | None) -> date:
    if value is None:
        return now_local().date()
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise HTTPException(400)


def _voice_message(slots: list[StatusSlot]) -> str:
    if not slots:
        return "등록된 복용 일정이 없어요."

    messages: list[str] = []
    completed: list[str] = []
    for slot in slots:
        name = SLOT_NAMES[slot.slot]
        if slot.status == DoseStatus.DONE and (taken_at := slot.taken_at) is not None:
            completed.append(f"{name} 약은 {taken_at.hour}시 {taken_at.minute}분에")
            continue
        if completed:
            messages.append(", ".join(completed) + " 드셨어요.")
            completed.clear()
        messages.append(f"{name} 약은 {VOICE_BY_STATUS[slot.status]}")
    if completed:
        messages.append(", ".join(completed) + " 드셨어요.")
    return " ".join(messages)


def _error(status_code: int, headers: Mapping[str, str] | None = None) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
        headers={**NO_STORE, **(headers or {})},
    )


@router.get(
    "/patients/{patient_id}/status",
    response_model=PatientStatus,
    responses={code: {"model": StatusError} for code in ERRORS},
)
def get_patient_status(
    patient_id: Annotated[str, Path(description="복용자 기기는 me, 보호자는 복용자 ID")],
    response: Response,
    date_query: Annotated[str | None, Query(alias="date", description="YYYY-MM-DD, 생략하면 오늘")] = None,
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        patient = _resolve_patient(patient_id, device_token, credentials, db)
        slot_date = _parse_date(date_query)
        doses = list_scheduled_doses(db, patient.id, slot_date)
        photo_urls = sign_dose_photos(dose.photo_path for dose in doses if dose.photo_path)
        counts = Counter(dose.status for dose in doses)
        slots = [
            StatusSlot(
                slot_id=dose.slot_id,
                slot=dose.slot,
                scheduled_at=dose.scheduled_at,
                expected_count=dose.expected_count,
                status=dose.status,
                result=dose.result,
                taken_at=dose.taken_at,
                photo_url=photo_urls.get(dose.photo_path) if dose.photo_path else None,
                can_verify=dose.status != DoseStatus.DONE,
                duplicate_warning=DUPLICATE_WARNING if dose.status == DoseStatus.DONE else None,
            )
            for dose in doses
        ]
        response.headers.update(NO_STORE)
        return PatientStatus(
            patient_id=patient.id,
            patient_name=patient.name,
            date=slot_date,
            voice_message=_voice_message(slots),
            summary=StatusSummary(
                total=len(doses),
                done=counts[DoseStatus.DONE],
                pending=counts[DoseStatus.PENDING],
                missed=counts[DoseStatus.MISSED],
                wrong=counts[DoseStatus.WRONG],
            ),
            slots=slots,
        )
    except HTTPException as exc:
        if exc.status_code in ERRORS:
            return _error(exc.status_code, exc.headers)
        logger.exception("Unexpected dose status HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not load dose status")
        return _error(500)
