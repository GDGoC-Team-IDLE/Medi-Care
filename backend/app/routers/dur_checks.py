"""DUR 의약품 주의사항 검사 (POST /api/v1/patients/{patient_id}/dur/checks/).

- 고른 처방전(여러 병원 가능)의 약을 함께 검사합니다. 판단은 식약처 DUR 데이터로만 하고,
  Gemini 는 원문을 쉬운 문장으로 바꾸기만 합니다 (조회 API 와 같은 app.dur, dur_lookup 로직 사용).
- 검사 결과는 원문과 쉬운 설명을 함께 dur_checks 테이블에 저장합니다.
"""

import logging
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import get_db
from app.core.envelope import ApiError, EnvelopeRoute, success
from app.dur import dur_warnings_with_seqs
from app.models import DurCheck, Patient, Prescription, PrescriptionDrug
from app.routers.auth import bearer, get_guardian_auth
from app.routers.dur_warnings import WARNING_TYPES, _with_easy_messages
from app.services.dur_lookup import MfdsUnavailable, fetch_dur_items

logger = logging.getLogger(__name__)
MAX_ID = 2_147_483_647
CheckType = Literal["CONCOMITANT_CONTRAINDICATION", "ELDERLY_CAUTION", "DUPLICATE_EFFICACY"]


class DurCheckRoute(EnvelopeRoute):
    invalid_request_message = "DUR 검사 요청 정보가 올바르지 않습니다."
    internal_error_message = "DUR 검사 중 오류가 발생했습니다."


router = APIRouter(tags=["dur checks"], route_class=DurCheckRoute)


class DurCheckRequest(BaseModel):
    prescription_ids: list[Annotated[StrictInt, Field(ge=1, le=MAX_ID)]] = Field(min_length=1, max_length=50)
    check_types: list[CheckType] = Field(min_length=1)


def _guardian_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> int:
    # 의존성으로 두어 요청 본문 검사(400)보다 인증(401)을 먼저 확인합니다.
    try:
        return get_guardian_auth(credentials, db).guardian_id
    except HTTPException:
        raise ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.") from None


@router.post(
    "/patients/{patient_id}/dur/checks/",
    responses={
        400: {"description": "잘못된 DUR 검사 요청"},
        401: {"description": "로그인 필요"},
        403: {"description": "복용자 접근 권한 없음"},
        404: {"description": "처방전 없음"},
        422: {"description": "성분을 확인할 수 없는 약 포함"},
        503: {"description": "식약처 DUR 서비스 사용 불가"},
        500: {"description": "DUR 검사 오류"},
    },
)
def create_dur_check(
    patient_id: Annotated[int, Path(ge=1, le=MAX_ID)],
    request: DurCheckRequest,
    guardian_id: int = Depends(_guardian_id),
    db: Session = Depends(get_db),
):
    patient = db.get(Patient, patient_id)
    if patient is None or patient.guardian_id != guardian_id:
        raise ApiError(403, "FORBIDDEN", "해당 복용자의 약물 정보를 조회할 권한이 없습니다.")

    prescription_ids = list(dict.fromkeys(request.prescription_ids))
    check_types = list(dict.fromkeys(request.check_types))
    # 다른 복용자의 처방전은 있는지 알려 주지 않도록 없는 처방전과 같이 404 로 답합니다.
    owned = db.scalars(
        select(Prescription.id).where(
            Prescription.id.in_(prescription_ids), Prescription.patient_id == patient.id
        )
    ).all()
    if len(owned) != len(prescription_ids):
        raise ApiError(404, "PRESCRIPTION_NOT_FOUND", "처방전 정보를 찾을 수 없습니다.")

    drugs = list(db.scalars(
        select(PrescriptionDrug)
        .where(PrescriptionDrug.prescription_id.in_(prescription_ids))
        .options(joinedload(PrescriptionDrug.drug_info))
        .order_by(PrescriptionDrug.id)
    ))
    # 품목을 찾지 못한 약(item_seq 없음)이 있으면 그 약이 빠진 채로 "주의사항 없음"이 되지 않게 검사하지 않습니다.
    if any(drug.drug_info is None for drug in drugs):
        raise ApiError(
            422, "MEDICATION_UNIDENTIFIED", "일부 약물의 성분을 확인할 수 없어 DUR 검사를 진행할 수 없습니다."
        )
    # 외부 API 를 부르는 동안 DB 커넥션을 잡고 있지 않도록 읽기 트랜잭션을 끝냅니다.
    db.commit()

    infos = {drug.drug_info.item_seq: drug.drug_info for drug in drugs}
    # 식약처 DUR 을 한 번 받은 약은 다시 부르지 않습니다 (낱알식별만 저장된 약은 dur_json 이 {}).
    missing = [
        item_seq for item_seq, info in infos.items()
        if not (isinstance(info.dur_json, dict) and "items" in info.dur_json)
    ]
    try:
        fetched = fetch_dur_items(missing)
    except MfdsUnavailable:
        logger.warning("MFDS DUR information was unavailable")
        raise ApiError(
            503, "DUR_SERVICE_UNAVAILABLE", "의약품 주의사항을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
        ) from None
    for item_seq, rows in fetched.items():
        infos[item_seq].dur_json = {"items": rows}

    found = [(warning, seqs) for warning, seqs in dur_warnings_with_seqs(drugs) if warning.type in check_types]
    found.sort(key=lambda pair: WARNING_TYPES.index(pair[0].type))
    warnings = [
        {
            "warning_id": index,
            "warning_type": warning.type,
            "medications": warning.drugs,
            "original_message": warning.original_message,
            "easy_message": warning.easy_message,
            "source": warning.source,
        }
        for index, warning in enumerate(_with_easy_messages(drugs, infos, found), start=1)
    ]

    checked_at = now_local().replace(microsecond=0)
    check = DurCheck(
        patient_id=patient.id,
        prescription_ids=prescription_ids,
        check_types=check_types,
        check_status="COMPLETED",
        medication_count=len(drugs),
        warnings_json=warnings,
        checked_at=checked_at,
    )
    db.add(check)
    db.commit()
    return success({
        "check_id": check.id,
        "patient_id": patient.id,
        "checked_at": checked_at.replace(tzinfo=ZoneInfo(get_settings().timezone)),
        "check_status": check.check_status,
        "medication_count": check.medication_count,
        "warning_count": len(warnings),
        "warnings": warnings,
    })
