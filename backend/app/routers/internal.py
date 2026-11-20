import logging
from hmac import compare_digest
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import get_db
from app.services.cron_tick import run_tick

router = APIRouter(tags=["internal"])
logger = logging.getLogger(__name__)


@router.post("/internal/tick")
def tick(
    cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    if not settings.cron_secret or not cron_secret or not compare_digest(
        settings.cron_secret.encode(), cron_secret.encode()
    ):
        return JSONResponse(
            {"code": "INVALID_CRON_SECRET", "message": "인증되지 않은 요청입니다."},
            status_code=401,
        )

    try:
        now = now_local()
        ran_at = now.replace(tzinfo=ZoneInfo(settings.timezone))
        missed, sent, skipped = run_tick(db, now, settings)
    except Exception:
        logger.exception("Could not complete cron tick")
        return JSONResponse(
            {"code": "INTERNAL_ERROR", "message": "주기 작업 처리 중 오류가 발생했어요."},
            status_code=500,
        )
    return {
        "ran_at": ran_at,
        "missed_marked": missed,
        "alerts_sent": sent,
        "skipped_duplicates": skipped,
    }
