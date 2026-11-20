from dataclasses import asdict
from hmac import compare_digest
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, StrictBool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import get_db
from app.core.envelope import ApiError, EnvelopeRoute, success
from app.models import Prescription
from app.services.pill_sync import MfdsUnavailable, sync_pill_appearances

internal_bearer = HTTPBearer(auto_error=False, scheme_name="PillSyncInternalBearer")


class PillSyncRoute(EnvelopeRoute):
    invalid_request_message = "낱알식별 정보 조회 요청이 올바르지 않습니다."
    internal_error_message = "낱알식별 정보 저장 중 오류가 발생했습니다."


router = APIRouter(tags=["pill appearances"], route_class=PillSyncRoute)


class PillSyncRequest(BaseModel):
    refresh: StrictBool


@router.post(
    "/prescriptions/{prescription_id}/pill-appearances/sync/",
    responses={
        400: {"description": "잘못된 동기화 요청"},
        401: {"description": "내부 토큰 인증 실패"},
        404: {"description": "처방전 없음"},
        503: {"description": "식약처 서비스 사용 불가"},
        500: {"description": "낱알 정보 저장 오류"},
    },
)
def sync_prescription_pills(
    prescription_id: Annotated[int, Path(ge=1, le=2_147_483_647)],
    request: PillSyncRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(internal_bearer),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    secret = settings.internal_token
    if not secret or credentials is None or not compare_digest(secret.encode(), credentials.credentials.encode()):
        raise ApiError(401, "UNAUTHORIZED", "인증되지 않은 요청입니다.")

    # 동일 처방의 동시 동기화와 처방 삭제는 같은 행 잠금으로 직렬화합니다.
    existing_id = db.scalar(
        select(Prescription.id).where(Prescription.id == prescription_id).with_for_update()
    )
    if existing_id is None:
        raise ApiError(404, "PRESCRIPTION_NOT_FOUND", "처방전 정보를 찾을 수 없습니다.")

    try:
        medications = sync_pill_appearances(
            db, prescription_id, refresh=request.refresh, service_key=settings.mfds_service_key
        )
    except MfdsUnavailable:
        raise ApiError(503, "MFDS_SERVICE_UNAVAILABLE", "의약품 식별 정보를 불러올 수 없습니다.") from None

    synced_at = now_local().replace(tzinfo=ZoneInfo(settings.timezone))
    db.commit()
    return success({
        "prescription_id": prescription_id,
        "sync_status": "COMPLETED",
        "medication_count": len(medications),
        "matched_count": sum(medication.lookup_status == "MATCHED" for medication in medications),
        "medications": [asdict(medication) for medication in medications],
        "source": "MFDS_PILL_IDENTIFICATION",
        "synced_at": synced_at,
    })
