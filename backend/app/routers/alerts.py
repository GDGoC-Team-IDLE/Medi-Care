import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, get_args
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models import GuardianAlert, Patient
from app.routers.auth import bearer, get_guardian_auth

router = APIRouter(tags=["alerts"])
logger = logging.getLogger(__name__)
NO_STORE = {"Cache-Control": "no-store"}
ERRORS = {
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}

AlertType = Literal["WRONG_DOSE", "MISSED", "WELFARE_CHECK", "MEDICATION_LOW"]


@dataclass(frozen=True)
class AlertItem:
    alert_id: int
    type: AlertType
    title: str
    body: str
    slot_id: int | None
    prescription_id: int | None
    created_at: datetime


@dataclass(frozen=True)
class AlertHistory:
    alerts: list[AlertItem]


@dataclass(frozen=True)
class AlertHistoryError:
    code: str
    message: str


def _error(status_code: int, headers: Mapping[str, str] | None = None) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
        headers={**(headers or {}), **NO_STORE},
    )


@router.get(
    "/patients/{patient_id}/alerts",
    response_model=AlertHistory,
    responses={code: {"model": AlertHistoryError} for code in ERRORS},
)
def get_patient_alerts(
    patient_id: int,
    response: Response,
    limit: int = Query(default=20, ge=0, description="가져올 알림 개수. 최대 100"),
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

        timezone = ZoneInfo(get_settings().timezone)
        alerts = db.scalars(
            select(GuardianAlert)
            .where(
                GuardianAlert.patient_id == patient_id,
                GuardianAlert.guardian_id == auth.guardian_id,
                GuardianAlert.type.in_(get_args(AlertType)),
            )
            .order_by(GuardianAlert.created_at.desc(), GuardianAlert.id.desc())
            .limit(min(limit, 100))
        )
        response.headers.update(NO_STORE)
        return AlertHistory(alerts=[
            AlertItem(
                alert_id=alert.id,
                type=alert.type,
                title=alert.title,
                body=alert.body,
                slot_id=alert.dose_slot_id,
                prescription_id=alert.prescription_id,
                created_at=alert.created_at.replace(tzinfo=timezone),
            )
            for alert in alerts
        ])
    except HTTPException as exc:
        if exc.status_code == 401:
            return _error(401, exc.headers)
        logger.exception("Unexpected alert history HTTP error")
        return _error(500)
    except Exception:
        logger.exception("Could not load guardian alerts")
        return _error(500)
