from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def now_local() -> datetime:
    """서비스 기준 시간대(기본 Asia/Seoul)의 현재 시각. DB 에는 tz 정보 없이 저장합니다."""
    tz = ZoneInfo(get_settings().timezone)
    return datetime.now(tz).replace(tzinfo=None)
