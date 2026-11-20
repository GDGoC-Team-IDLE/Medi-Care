import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.enums import DoseStatus, MealTiming, Slot, VerifyResult
from app.models import DoseLog, DoseSlot, Prescription, PrescriptionDrug
from app.routers.auth import bearer
from app.routers.dose_status import _resolve_patient, device_header

logger = logging.getLogger(__name__)
router = APIRouter(tags=["prescriptions"])
ERRORS = {
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}


class PrescriptionProgress(BaseModel):
    done: int = 0
    total: int = 0


class DrugItem(BaseModel):
    id: int
    name: str
    item_seq: str | None
    count_per_dose: int
    slots: list[Slot]
    meal_timing: MealTiming
    days: int


class PrescriptionItem(BaseModel):
    prescription_id: int
    start_date: date
    end_date: date
    is_active: bool
    progress: PrescriptionProgress
    drugs: list[DrugItem]


class PrescriptionList(BaseModel):
    prescriptions: list[PrescriptionItem]


class PrescriptionListError(BaseModel):
    code: str
    message: str


def _error(status_code: int) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        {"code": code, "message": message}, status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


def _list_prescriptions(db: Session, patient_id: int, today: date, active: bool) -> list[PrescriptionItem]:
    rows = db.execute(
        select(Prescription.id, Prescription.start_date, Prescription.days)
        .where(Prescription.patient_id == patient_id)
        .order_by(Prescription.start_date.desc(), Prescription.id.desc())
    )
    selected = []
    for rx in rows:
        end = rx.start_date + timedelta(days=rx.days - 1)
        if not active or end >= today:
            selected.append((rx, end))
    if not selected:
        return []

    rx_days = {rx.id: rx.days for rx, _ in selected}
    # 일정 조회와 같이, 기존 데이터에 성공 인증이 남아 있으면 완료로 집계합니다.
    has_ok = select(DoseLog.id).where(
        DoseLog.dose_slot_id == DoseSlot.id,
        DoseLog.result == VerifyResult.OK,
    ).exists()
    progress = {
        rx_id: PrescriptionProgress(done=done, total=total)
        for rx_id, done, total in db.execute(
            select(
                DoseSlot.prescription_id,
                func.count().filter(or_(DoseSlot.status == DoseStatus.DONE, has_ok)),
                func.count(),
            )
            .where(DoseSlot.patient_id == patient_id, DoseSlot.prescription_id.in_(rx_days))
            .group_by(DoseSlot.prescription_id)
        )
    }
    drugs: dict[int, list[DrugItem]] = defaultdict(list)
    for drug in db.scalars(
        select(PrescriptionDrug)
        .where(PrescriptionDrug.prescription_id.in_(rx_days))
        .order_by(PrescriptionDrug.id)
    ):
        drugs[drug.prescription_id].append(DrugItem(
            id=drug.id,
            name=drug.drug_name,
            item_seq=drug.item_seq,
            count_per_dose=drug.count_per_dose,
            slots=drug.slots,
            meal_timing=drug.meal_timing,
            days=drug.days if drug.days is not None else rx_days[drug.prescription_id],
        ))
    return [
        PrescriptionItem(
            prescription_id=rx.id,
            start_date=rx.start_date,
            end_date=end,
            is_active=end >= today,
            progress=progress.get(rx.id) or PrescriptionProgress(),
            drugs=drugs[rx.id],
        )
        for rx, end in selected
    ]


@router.get(
    "/patients/{patient_id}/prescriptions",
    response_model=PrescriptionList,
    responses={code: {"model": PrescriptionListError} for code in ERRORS},
)
def list_prescriptions(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    response: Response,
    active: bool = Query(default=True, description="복용 기간이 끝나지 않은 처방만 조회"),
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        patient = _resolve_patient(patient_id, device_token, credentials, db)
        today = now_local().date()
        prescriptions = _list_prescriptions(db, patient.id, today, active)
        response.headers["Cache-Control"] = "no-store"
        return PrescriptionList(prescriptions=prescriptions)
    except HTTPException as exc:
        if exc.status_code in ERRORS:
            return _error(exc.status_code)
        logger.exception("Unexpected prescription list HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not list prescriptions")
        return _error(500)
