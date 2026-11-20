import logging
from collections.abc import Mapping
from dataclasses import replace
from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import get_db
from app.dur import (
    CONCOMITANT,
    DUPLICATE,
    DurWarning,
    cached_easy_messages,
    dur_warnings_with_seqs,
    easy_key,
    with_closing,
)
from app.models import DrugInfo, Prescription, PrescriptionDrug
from app.routers.auth import bearer
from app.routers.dose_status import _resolve_patient, device_header
from app.services.dur_lookup import MfdsUnavailable, fetch_dur_items, to_easy_messages

logger = logging.getLogger(__name__)
router = APIRouter(tags=["dur warnings"])

ERRORS = {
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
    503: ("MFDS_UNAVAILABLE", "지금 약 주의사항을 확인할 수 없어요. 잠시 후 다시 시도해 주세요."),
}
# 응답에 담는 종류와 순서 (병용금기를 맨 위에)
WARNING_TYPES = (CONCOMITANT, "ELDERLY_CAUTION", DUPLICATE)
NO_STORE = {"Cache-Control": "no-store"}


class DurError(BaseModel):
    code: str
    message: str


class DurWarnings(BaseModel):
    checked_at: datetime
    drug_count: int
    warning_count: int
    warnings: list[DurWarning]
    unidentified_drugs: list[str]
    message: str


def _active_drugs(db: Session, patient_id: int, today: date) -> list[PrescriptionDrug]:
    # 「진료 동행 리포트」와 같은 기준: 오늘이 복용 기간 안에 있는 처방의 약 (병원 구분 없이 모두)
    prescriptions = db.execute(
        select(Prescription.id, Prescription.start_date, Prescription.days)
        .where(Prescription.patient_id == patient_id, Prescription.start_date <= today)
    )
    active = [rx.id for rx in prescriptions if (today - rx.start_date).days < rx.days]
    if not active:
        return []
    return list(db.scalars(
        select(PrescriptionDrug)
        .join(Prescription)
        .where(PrescriptionDrug.prescription_id.in_(active))
        .options(joinedload(PrescriptionDrug.drug_info))
        .order_by(Prescription.start_date, PrescriptionDrug.id)
    ))


def _with_easy_messages(
    drugs: list[PrescriptionDrug],
    infos: dict[str, DrugInfo],
    found: list[tuple[DurWarning, tuple[str, ...] | None]],
) -> list[DurWarning]:
    """캐시에 없는 쉬운 문장만 Gemini 로 만들어 (경고 종류, 약, 상대 약) 단위로 관련 약의 drug_info 에 저장합니다.

    Gemini 가 실패하거나 빈 문장이면 식약처 원문(dur_warnings_with_seqs 의 기본값)을 그대로 쓰고,
    저장하지 않아 다음 조회 때 다시 만듭니다.
    """
    cached = cached_easy_messages(drugs)
    keys = [easy_key(warning.type, seqs) if seqs else None for warning, seqs in found]
    missing = [warning for (warning, _), key in zip(found, keys) if key and key not in cached]
    inputs = list(dict.fromkeys((warning.type, warning.original_message) for warning in missing))
    made = dict(zip(inputs, (to_easy_messages(inputs) if inputs else None) or []))
    result = []
    for (warning, seqs), key in zip(found, keys):
        text = made.get((warning.type, warning.original_message)) if key and key not in cached else None
        if text and key and seqs:
            for item_seq in seqs:
                if (info := infos.get(item_seq)) is not None:
                    saved = info.dur_json.get("easy_messages", {})
                    info.dur_json = {**info.dur_json, "easy_messages": {**saved, key: text}}
            warning = replace(warning, easy_message=with_closing(text))
        result.append(warning)
    return result


def _message(drug_count: int, warning_count: int, unidentified_count: int) -> str:
    if not drug_count:
        return "지금 드시는 약이 없어요."
    message = "약을 드시기 전에 주의사항을 확인해 주세요." if warning_count else "확인된 주의사항은 없어요."
    if unidentified_count:
        return f"{message} 약 {unidentified_count}개는 정보를 찾지 못했으니 약사에게 확인해 주세요."
    if not warning_count:
        # 주의사항이 없다고 안전하다는 뜻은 아니므로 확인 안내를 함께 둡니다.
        return f"{message} 궁금한 점은 의사나 약사에게 확인해 주세요."
    return message


def _error(status_code: int, headers: Mapping[str, str] | None = None) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
        headers={**NO_STORE, **(headers or {})},
    )


@router.get(
    "/patients/{patient_id}/dur-warnings",
    response_model=DurWarnings,
    responses={code: {"model": DurError} for code in ERRORS},
)
def get_dur_warnings(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    response: Response,
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        patient = _resolve_patient(patient_id, device_token, credentials, db)
        checked_at = now_local().replace(microsecond=0, tzinfo=ZoneInfo(get_settings().timezone))
        drugs = _active_drugs(db, patient.id, checked_at.date())
        # 외부 API 를 부르는 동안 DB 커넥션을 잡고 있지 않도록 읽기 트랜잭션을 끝냅니다.
        db.commit()

        # 처방 등록 때 품목을 찾지 못한 약(item_seq 없음)은 오류 대신 따로 알려 줍니다.
        unidentified = list(dict.fromkeys(drug.drug_name for drug in drugs if drug.drug_info is None))
        infos = {drug.drug_info.item_seq: drug.drug_info for drug in drugs if drug.drug_info is not None}
        # 식약처 DUR 을 한 번 받은 약은 다시 부르지 않습니다 (낱알식별만 저장된 약은 dur_json 이 {}).
        missing = [
            item_seq for item_seq, info in infos.items()
            if not (isinstance(info.dur_json, dict) and "items" in info.dur_json)
        ]
        for item_seq, rows in fetch_dur_items(missing).items():
            infos[item_seq].dur_json = {"items": rows}

        found = [(warning, seqs) for warning, seqs in dur_warnings_with_seqs(drugs) if warning.type in WARNING_TYPES]
        found.sort(key=lambda pair: WARNING_TYPES.index(pair[0].type))
        warnings = _with_easy_messages(drugs, infos, found)
        db.commit()
        response.headers.update(NO_STORE)
        return DurWarnings(
            checked_at=checked_at,
            drug_count=len(drugs),
            warning_count=len(warnings),
            warnings=warnings,
            unidentified_drugs=unidentified,
            message=_message(len(drugs), len(warnings), len(unidentified)),
        )
    except MfdsUnavailable:
        logger.warning("MFDS DUR information was unavailable")
        return _error(503)
    except HTTPException as exc:
        if exc.status_code in ERRORS:
            return _error(exc.status_code, exc.headers)
        logger.exception("Unexpected DUR warnings HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not check DUR warnings")
        return _error(500)
