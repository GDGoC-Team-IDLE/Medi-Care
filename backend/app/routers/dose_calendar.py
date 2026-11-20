import logging
import re
from calendar import monthrange
from collections import Counter, defaultdict
from collections.abc import Mapping
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.database import get_db
from app.enums import DoseStatus, VerifyResult
from app.models import DoseLog, DoseSlot
from app.routers.auth import bearer
from app.routers.dose_status import _resolve_patient, device_header

logger = logging.getLogger(__name__)
router = APIRouter(tags=["dose calendar"])

ERRORS = {
    400: ("INVALID_MONTH", "달은 2026-11 형식으로 보내 주세요."),
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}
NO_STORE = {"Cache-Control": "no-store"}


class CalendarError(BaseModel):
    code: str
    message: str


class CalendarDay(BaseModel):
    date: date
    total: int
    done: int
    missed: int
    wrong: int
    pending: int
    photo_count: int
    day_status: Literal["ALL_DONE", "PARTIAL", "NONE_DONE", "UPCOMING"]


class CalendarSummary(BaseModel):
    total: int
    done: int
    missed: int
    wrong: int
    pending: int
    adherence_rate: float


class PatientCalendar(BaseModel):
    month: str
    days: list[CalendarDay]
    summary: CalendarSummary


def _parse_month(value: str | None, today: date) -> date:
    if value is None:
        return today.replace(day=1)
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        try:
            return date.fromisoformat(f"{value}-01")
        except ValueError:
            pass
    raise HTTPException(400)


def _day_status(day: date, today: date, counts: Counter[DoseStatus]) -> str:
    if day > today or (day == today and counts[DoseStatus.PENDING]):
        return "UPCOMING"
    if counts[DoseStatus.DONE] == counts.total():
        return "ALL_DONE"
    if counts[DoseStatus.DONE] == 0:
        return "NONE_DONE"
    return "PARTIAL"


def _error(status_code: int, headers: Mapping[str, str] | None = None) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
        headers={**NO_STORE, **(headers or {})},
    )


@router.get(
    "/patients/{patient_id}/calendar",
    response_model=PatientCalendar,
    responses={code: {"model": CalendarError} for code in ERRORS},
)
def get_patient_calendar(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    response: Response,
    month: Annotated[str | None, Query(description="YYYY-MM, 없으면 이번 달")] = None,
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    try:
        patient = _resolve_patient(patient_id, device_token, credentials, db)
        today = now_local().date()
        first = _parse_month(month, today)
        last = first.replace(day=monthrange(first.year, first.month)[1])

        # 「복용 일정 조회」와 같은 기준으로 셉니다: OK 인증이 있으면 복용 완료,
        # 사진은 완료 회차는 OK 사진만, 나머지 회차는 아무 시도 사진이나 있으면 1장입니다.
        has_ok = exists().where(DoseLog.dose_slot_id == DoseSlot.id, DoseLog.result == VerifyResult.OK)
        has_photo = exists().where(
            DoseLog.dose_slot_id == DoseSlot.id,
            or_(DoseSlot.status != DoseStatus.DONE, DoseLog.result == VerifyResult.OK),
        )
        rows = db.execute(
            select(DoseSlot.slot_date, DoseSlot.status, has_ok, has_photo)
            .where(DoseSlot.patient_id == patient.id, DoseSlot.slot_date.between(first, last))
        )
        by_day: defaultdict[date, Counter[DoseStatus]] = defaultdict(Counter)
        photos: Counter[date] = Counter()
        for slot_date, status, ok, photo in rows:
            by_day[slot_date][DoseStatus.DONE if ok else status] += 1
            photos[slot_date] += bool(photo)

        days = [
            CalendarDay(
                date=day,
                total=counts.total(),
                done=counts[DoseStatus.DONE],
                missed=counts[DoseStatus.MISSED],
                wrong=counts[DoseStatus.WRONG],
                pending=counts[DoseStatus.PENDING],
                photo_count=photos[day],
                day_status=_day_status(day, today, counts),
            )
            for day, counts in sorted(by_day.items())
        ]
        totals = sum(by_day.values(), Counter())
        total = totals.total()
        finished = total - totals[DoseStatus.PENDING]
        response.headers.update(NO_STORE)
        return PatientCalendar(
            month=first.isoformat()[:7],
            days=days,
            summary=CalendarSummary(
                total=total,
                done=totals[DoseStatus.DONE],
                missed=totals[DoseStatus.MISSED],
                wrong=totals[DoseStatus.WRONG],
                pending=totals[DoseStatus.PENDING],
                adherence_rate=round(100 * totals[DoseStatus.DONE] / finished, 1) if finished else 0.0,
            ),
        )
    except HTTPException as exc:
        if exc.status_code in ERRORS:
            return _error(exc.status_code, exc.headers)
        logger.exception("Unexpected dose calendar HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not load dose calendar")
        return _error(500)
