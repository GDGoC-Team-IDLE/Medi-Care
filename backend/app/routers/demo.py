"""시연 시계: 어르신 화면 '다음 시간대로 이동'을 누르면 서버의 '지금'을 그 어르신의 다음 예정 회차 시각으로 옮깁니다.

모든 서버 시각이 now_local() 을 거치므로, 옮기면 오늘 회차 · 오늘 먹은 약 · 달력 · 보호자 현황이 함께 그 시각을 따릅니다.
시연 설정(DEMO_ANY_DAY)이 켜진 서버에서만 동작합니다 (꺼져 있으면 404, 저장된 시계도 무시).
시계는 서버 전체에 하나라, 같은 서버를 쓰는 모두에게 적용됩니다.

    GET  /api/v1/demo/now                              지금(시연 시각) · 설정 · 옮긴 초
    POST /api/v1/patients/{patient_id}/demo/next       다음 예정 회차 시각으로 (어르신 폰은 me)
    POST /api/v1/patients/{patient_id}/demo/reset      실제 시각으로
"""

import math
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import demo_offset, now_local, set_demo_offset
from app.core.config import get_settings
from app.core.database import SessionLocal, get_db
from app.dose_schedule import SLOT_TIMES
from app.enums import DoseStatus
from app.models import DemoClock, DoseSlot, Patient
from app.routers.auth import bearer
from app.routers.dose_status import _resolve_patient, device_header

router = APIRouter(tags=["demo"])

ERRORS = {
    "DEMO_OFF": (404, "시연 설정(DEMO_ANY_DAY)이 꺼져 있어요."),
    "NO_NEXT_DOSE": (404, "다음 약이 없어요."),
    "UNAUTHORIZED": (401, "로그인 정보가 없어요. 다시 로그인해 주세요."),
    "FORBIDDEN": (403, "이 어르신의 정보에 접근할 수 없어요."),
    "PATIENT_NOT_FOUND": (404, "어르신 정보를 찾을 수 없어요."),
}
HTTP_CODES = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "PATIENT_NOT_FOUND"}


def _error(code: str) -> JSONResponse:
    status_code, message = ERRORS[code]
    return JSONResponse({"code": code, "message": message}, status_code=status_code)


def load_demo_clock() -> None:
    """서버를 켤 때 DB 의 시연 시계를 읽습니다 (무료 서버가 잠들었다 깨도 시연 시각이 이어지게)."""
    with SessionLocal() as db:
        row = db.get(DemoClock, 1)
        set_demo_offset(row.offset_seconds if row else 0)


def _save(db: Session, seconds: float) -> None:
    row = db.get(DemoClock, 1) or DemoClock(id=1)
    row.offset_seconds = int(seconds)
    db.add(row)
    db.commit()
    set_demo_offset(seconds)


def _iso(value: datetime) -> str:
    return value.replace(tzinfo=ZoneInfo(get_settings().timezone)).isoformat(timespec="seconds")


def _patient(patient_id: str, device_token: str | None, credentials: HTTPAuthorizationCredentials | None, db: Session) -> Patient | JSONResponse:
    try:
        return _resolve_patient(patient_id, device_token, credentials, db)
    except HTTPException as exc:
        return _error(HTTP_CODES.get(exc.status_code, "FORBIDDEN"))


@router.get("/demo/now")
def demo_now():
    return {"demo": get_settings().demo_any_day, "now": _iso(now_local()), "offset_seconds": demo_offset()}


@router.post("/patients/{patient_id}/demo/next")
def demo_next(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    if not get_settings().demo_any_day:
        return _error("DEMO_OFF")
    patient = _patient(patient_id, device_token, credentials, db)
    if isinstance(patient, JSONResponse):
        return patient
    now = now_local()
    pending = db.scalars(
        select(DoseSlot).where(
            DoseSlot.patient_id == patient.id,
            DoseSlot.status == DoseStatus.PENDING,
            DoseSlot.slot_date >= now.date(),
        )
    ).all()
    upcoming = sorted(
        ((datetime.combine(s.slot_date, SLOT_TIMES[s.slot]), s) for s in pending),
        key=lambda pair: pair[0],
    )
    upcoming = [pair for pair in upcoming if pair[0] > now]
    if not upcoming:
        return _error("NO_NEXT_DOSE")
    at, slot = upcoming[0]
    # 올림: 초 아래를 버리면 '지금'이 회차 시각보다 1초 모자라 다음을 눌러도 같은 회차를 다시 고른다
    _save(db, demo_offset() + math.ceil((at - now).total_seconds()))
    return {"now": _iso(now_local()), "slot_id": slot.id, "slot": slot.slot.value, "date": slot.slot_date.isoformat()}


@router.post("/patients/{patient_id}/demo/reset")
def demo_reset(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    if not get_settings().demo_any_day:
        return _error("DEMO_OFF")
    patient = _patient(patient_id, device_token, credentials, db)
    if isinstance(patient, JSONResponse):
        return patient
    _save(db, 0)
    return {"now": _iso(now_local())}
