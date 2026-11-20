"""복용 일정 조회: 특정 날짜의 회차 목록과 회차별 먹을 약, 마지막 인증 기록을 돌려줍니다.

    GET /api/v1/patients/{patient_id}/dose-slots?date=2026-11-20

인증: 어르신 폰은 X-Device-Token + patient_id=me, 보호자 앱은 Authorization: Bearer <JWT> + 어르신 ID.
그날 회차가 없으면 빈 목록을 돌려줍니다. 에러는 {"code", "message"}.
"""

import logging
from collections import Counter
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.photo_storage import sign_dose_photos
from app.dose_schedule import list_scheduled_doses
from app.enums import DoseStatus, MealTiming, Slot, VerifyResult
from app.models import PrescriptionDrug
from app.routers.auth import bearer
from app.routers.dose_status import StatusError, StatusSummary, _parse_date, _resolve_patient, device_header

logger = logging.getLogger(__name__)
router = APIRouter(tags=["dose slots"])

ERRORS = {
    400: ("INVALID_DATE", "날짜는 2026-11-20 형식으로 보내 주세요."),
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}


class SlotDrug(BaseModel):
    name: str
    count_per_dose: int
    meal_timing: MealTiming


class LastLog(BaseModel):
    dose_log_id: int
    result: VerifyResult
    taken_at: datetime
    photo_url: str | None


class DoseSlotItem(BaseModel):
    slot_id: int
    prescription_id: int
    slot: Slot
    scheduled_at: datetime
    expected_count: int
    status: DoseStatus
    drugs: list[SlotDrug]
    last_log: LastLog | None


class DoseSlotsResponse(BaseModel):
    date: date
    slots: list[DoseSlotItem]
    summary: StatusSummary


def _error(status_code: int) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


@router.get(
    "/patients/{patient_id}/dose-slots",
    response_model=DoseSlotsResponse,
    responses={code: {"model": StatusError} for code in ERRORS},
)
def get_dose_slots(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    date_query: Annotated[str | None, Query(alias="date", description="YYYY-MM-DD, 없으면 오늘")] = None,
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        patient = _resolve_patient(patient_id, device_token, credentials, db)
        slot_date = _parse_date(date_query)
        doses = list_scheduled_doses(db, patient.id, slot_date)
        drugs = db.scalars(
            select(PrescriptionDrug)
            .where(PrescriptionDrug.prescription_id.in_({dose.prescription_id for dose in doses}))
            .order_by(PrescriptionDrug.id)
        ).all()
        photo_urls = sign_dose_photos(dose.photo_path for dose in doses if dose.photo_path)
        counts = Counter(dose.status for dose in doses)
        slots = [
            DoseSlotItem(
                slot_id=dose.slot_id,
                prescription_id=dose.prescription_id,
                slot=dose.slot,
                scheduled_at=dose.scheduled_at,
                expected_count=dose.expected_count,
                status=dose.status,
                drugs=[
                    SlotDrug(name=drug.drug_name, count_per_dose=drug.count_per_dose, meal_timing=drug.meal_timing)
                    for drug in drugs
                    if drug.prescription_id == dose.prescription_id and dose.slot in drug.slots
                ],
                last_log=LastLog(
                    dose_log_id=dose.dose_log_id,
                    result=dose.result,
                    taken_at=dose.taken_at,
                    photo_url=photo_urls.get(dose.photo_path),
                )
                if dose.dose_log_id is not None
                else None,
            )
            for dose in doses
        ]
        return DoseSlotsResponse(
            date=slot_date,
            slots=slots,
            summary=StatusSummary(
                total=len(doses),
                done=counts[DoseStatus.DONE],
                pending=counts[DoseStatus.PENDING],
                missed=counts[DoseStatus.MISSED],
                wrong=counts[DoseStatus.WRONG],
            ),
        )
    except HTTPException as exc:
        if exc.status_code in ERRORS:
            return _error(exc.status_code)
        logger.exception("Unexpected dose slots HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not load dose slots")
        return _error(500)
