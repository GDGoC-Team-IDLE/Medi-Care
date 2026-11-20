import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BeforeValidator
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.core.report_summary import summarize_report
from app.dose_report import (
    Adherence,
    Medication,
    MissedSummary,
    WrongRecord,
    adherence_for_period,
    current_medications,
    wrong_records_for_period,
)
from app.dur import DurWarning
from app.models import Patient
from app.routers.auth import bearer, get_guardian_auth

router = APIRouter(tags=["reports"])
logger = logging.getLogger(__name__)

ERRORS = {
    400: ("INVALID_DAYS", "기간은 14 또는 30으로 보내 주세요."),
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "리포트를 만드는 중 오류가 발생했어요."),
}


@dataclass(frozen=True)
class ReportError:
    code: str
    message: str


@dataclass(frozen=True)
class PatientReport:
    patient_id: int
    days: int
    start_date: date
    end_date: date
    medications: list[Medication]
    adherence: Adherence
    missed_summary: MissedSummary
    wrong_records: list[WrongRecord]
    dur_warnings: list[DurWarning]
    ai_summary: str


def _error(code: int, headers: Mapping[str, str] | None = None) -> JSONResponse:
    error_code, message = ERRORS[code]
    return JSONResponse(
        status_code=code,
        content={"code": error_code, "message": message},
        headers={**(headers or {}), "Cache-Control": "no-store"},
    )


def _parse_days(value: str | int) -> int:
    # 정수 쿼리 스키마를 유지하면서 잘못된 기간은 명세의 400으로 반환합니다.
    if isinstance(value, str):
        return {"14": 14, "30": 30}.get(value, 0)
    return value


@router.get(
    "/patients/{patient_id}/report",
    response_model=PatientReport,
    responses={code: {"model": ReportError} for code in ERRORS},
)
def get_patient_report(
    patient_id: int,
    response: Response,
    days: Annotated[int, BeforeValidator(_parse_days), Query(description="조회 기간(일). 14 또는 30")] = 14,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        auth = get_guardian_auth(credentials, db)
        if days not in {14, 30}:
            return _error(400)
        patient = db.get(Patient, patient_id) if 1 <= patient_id <= 2_147_483_647 else None
        if patient is None:
            return _error(404)
        if patient.guardian_id != auth.guardian_id:
            return _error(403)

        end_date = now_local().date()
        start_date = end_date - timedelta(days=days - 1)
        medications, dur_warnings = current_medications(db, patient_id, end_date)
        adherence, missed_summary = adherence_for_period(db, patient_id, start_date, end_date)
        wrong_records = wrong_records_for_period(db, patient_id, start_date, end_date)
        # 외부 요약 호출 전에 조회용 DB 커넥션을 반환합니다.
        db.close()
        ai_summary = summarize_report(days, adherence, missed_summary, wrong_records)
        response.headers["Cache-Control"] = "no-store"
        return PatientReport(
            patient_id=patient_id,
            days=days,
            start_date=start_date,
            end_date=end_date,
            medications=medications,
            adherence=adherence,
            missed_summary=missed_summary,
            wrong_records=wrong_records,
            dur_warnings=dur_warnings,
            ai_summary=ai_summary,
        )
    except HTTPException as exc:
        if exc.status_code in ERRORS:
            return _error(exc.status_code, exc.headers)
        logger.exception("Unexpected report HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not build medication report")
        return _error(500)
