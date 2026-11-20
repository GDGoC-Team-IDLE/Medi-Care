"""처방(약봉투) 삭제. 잘못 등록한 처방을 약 목록·회차와 함께 지우고, 지운 회차 ID 를 돌려줍니다.

- 인증: 보호자 앱은 Authorization: Bearer <JWT>, 어르신 폰은 X-Device-Token.
- 인증 기록(dose_logs)이 하나라도 있으면 사진 복약 달력과 복용 기록이 사라지므로 지우지 않습니다 (409).
- 앱은 deleted_slot_ids 로 예약해 둔 폰 로컬 알림을 취소합니다.
"""

import logging
import re
from collections.abc import Mapping
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import DoseLog, DoseSlot, GuardianAlert, GuardianNotification, Prescription, PrescriptionDrug
from app.routers.auth import bearer, get_guardian_auth
from app.routers.dose_status import device_header
from app.routers.patients import get_device_patient

logger = logging.getLogger(__name__)
router = APIRouter(tags=["prescriptions"])

ERRORS = {
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 처방을 지울 권한이 없어요."),
    404: ("PRESCRIPTION_NOT_FOUND", "약봉투 정보를 찾을 수 없어요."),
    409: ("PRESCRIPTION_HAS_RECORDS", "이미 복용 인증 기록이 있는 약봉투는 지울 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}
DELETED_MESSAGE = "약봉투 등록을 취소했어요."
NO_STORE = {"Cache-Control": "no-store"}
MAX_ID = 2_147_483_647  # PostgreSQL INTEGER 최댓값


class PrescriptionError(BaseModel):
    code: str
    message: str


class DeletedPrescription(BaseModel):
    prescription_id: int
    deleted_slot_ids: list[int]
    message: str


def _error(status_code: int, headers: Mapping[str, str] | None = None) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
        headers={**NO_STORE, **(headers or {})},
    )


def _caller(
    device_token: str | None,
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> tuple[int | None, int | None]:
    """(어르신 ID, 보호자 ID) 중 호출한 쪽 하나만 채워 돌려줍니다. 둘 다 아니면 401."""
    if device_token:
        try:
            return get_device_patient(device_token, db).id, None
        except HTTPException:
            if credentials is None:
                raise
    return None, get_guardian_auth(credentials, db).guardian_id


def _parse_id(value: str) -> int:
    # 숫자가 아니거나 INTEGER 범위를 넘는 ID 는 「잘못된 ID」로 보고 404 를 돌려줍니다.
    if re.fullmatch(r"[0-9]{1,10}", value) and 1 <= int(value) <= MAX_ID:
        return int(value)
    raise HTTPException(404)


@router.delete(
    "/prescriptions/{prescription_id}",
    response_model=DeletedPrescription,
    responses={code: {"model": PrescriptionError} for code in ERRORS},
)
def delete_prescription(
    prescription_id: Annotated[str, Path(description="지울 처방 ID")],
    response: Response,
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        patient_id, guardian_id = _caller(device_token, credentials, db)
        rx_id = _parse_id(prescription_id)

        # 같은 처방을 동시에 지우거나, 지우는 사이 복용 인증이 들어오는 경우와 겹치지 않게 행을 잠급니다.
        # (인증 기록 INSERT 는 회차 행을 참조하므로 회차 잠금이 풀릴 때까지 기다립니다.)
        prescription = db.scalar(select(Prescription).where(Prescription.id == rx_id).with_for_update())
        if prescription is None:
            raise HTTPException(404)
        if patient_id is not None:
            allowed = prescription.patient_id == patient_id
        else:
            allowed = prescription.patient.guardian_id == guardian_id
        if not allowed:
            raise HTTPException(403)

        slot_ids = list(db.scalars(
            select(DoseSlot.id)
            .where(DoseSlot.prescription_id == rx_id)
            .order_by(DoseSlot.id)
            .with_for_update()
        ))
        if slot_ids and db.scalar(select(DoseLog.id).where(DoseLog.dose_slot_id.in_(slot_ids)).limit(1)):
            raise HTTPException(409)

        # DB 의 ON DELETE CASCADE 에 기대지 않고 딸린 행을 직접 지웁니다 (배포 DB 스키마와 상관없이 같게 동작).
        db.execute(delete(GuardianAlert).where(or_(
            GuardianAlert.prescription_id == rx_id,
            GuardianAlert.dose_slot_id.in_(slot_ids),
        )))
        db.execute(delete(GuardianNotification).where(GuardianNotification.prescription_id == rx_id))
        db.execute(delete(DoseSlot).where(DoseSlot.prescription_id == rx_id))
        db.execute(delete(PrescriptionDrug).where(PrescriptionDrug.prescription_id == rx_id))
        db.execute(delete(Prescription).where(Prescription.id == rx_id))
        db.commit()

        response.headers.update(NO_STORE)
        return DeletedPrescription(prescription_id=rx_id, deleted_slot_ids=slot_ids, message=DELETED_MESSAGE)
    except HTTPException as exc:
        db.rollback()
        if exc.status_code in ERRORS:
            return _error(exc.status_code, exc.headers)
        logger.exception("Unexpected prescription delete HTTP error")
        return _error(500)
    except Exception:
        db.rollback()
        logger.exception("Could not delete prescription")
        return _error(500)
