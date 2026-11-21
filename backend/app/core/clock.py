from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import get_settings

# 시연 시계: 실제 시각에 더할 초. routers/demo.py 가 바꾸고 DB(demo_clock)에 저장합니다.
# 시연 설정(DEMO_ANY_DAY)이 켜져 있을 때만 쓰고, 꺼져 있으면 값이 남아 있어도 실제 시각만 씁니다.
_demo_offset_seconds = 0


def set_demo_offset(seconds: float) -> None:
    global _demo_offset_seconds
    _demo_offset_seconds = int(seconds)


def demo_offset() -> int:
    return _demo_offset_seconds


def now_local() -> datetime:
    """서비스 기준 시간대(기본 Asia/Seoul)의 현재 시각. DB 에는 tz 정보 없이 저장합니다.

    시연 설정이 켜져 있으면 시연 시계만큼 옮긴 시각입니다 ('다음 시간대로 이동').
    """
    tz = ZoneInfo(get_settings().timezone)
    now = datetime.now(tz).replace(tzinfo=None)
    if _demo_offset_seconds and get_settings().demo_any_day:
        now += timedelta(seconds=_demo_offset_seconds)
    return now
