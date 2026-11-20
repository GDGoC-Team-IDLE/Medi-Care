from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.enums import DoseStatus, Slot, VerifyResult
from app.models import DoseLog, DoseSlot


# 회차에는 날짜만 저장되므로 서비스의 기본 시각을 붙입니다.
SLOT_TIMES = {
    Slot.MORNING: time(8, 0),
    Slot.LUNCH: time(12, 30),
    Slot.DINNER: time(18, 30),
    Slot.BEDTIME: time(22, 0),
}


@dataclass(frozen=True)
class ScheduledDose:
    slot_id: int
    prescription_id: int
    slot: Slot
    scheduled_at: datetime
    expected_count: int
    status: DoseStatus
    dose_log_id: int | None
    result: VerifyResult | None
    taken_at: datetime | None
    photo_path: str | None


def list_scheduled_doses(db: Session, patient_id: int, slot_date: date) -> list[ScheduledDose]:
    # 중복 촬영 기록이 추가되어도 완료에 사용된 사진과 시각을 유지합니다.
    log_id = (
        select(DoseLog.id)
        .where(
            DoseLog.dose_slot_id == DoseSlot.id,
            or_(DoseSlot.status != DoseStatus.DONE, DoseLog.result == VerifyResult.OK),
        )
        .order_by(
            (DoseLog.result == VerifyResult.OK).desc(),
            DoseLog.created_at.desc(),
            DoseLog.id.desc(),
        )
        .limit(1)
        .correlate(DoseSlot)
        .scalar_subquery()
    )
    rows = db.execute(
        select(DoseSlot, DoseLog.id, DoseLog.result, DoseLog.created_at, DoseLog.photo_path)
        .outerjoin(DoseLog, DoseLog.id == log_id)
        .where(DoseSlot.patient_id == patient_id, DoseSlot.slot_date == slot_date)
    )
    timezone = ZoneInfo(get_settings().timezone)
    doses = [
        ScheduledDose(
            slot_id=slot.id,
            prescription_id=slot.prescription_id,
            slot=slot.slot,
            scheduled_at=datetime.combine(slot.slot_date, SLOT_TIMES[slot.slot], timezone),
            expected_count=slot.expected_count,
            status=DoseStatus.DONE if result == VerifyResult.OK else slot.status,
            dose_log_id=dose_log_id,
            result=result,
            taken_at=created_at.replace(tzinfo=timezone) if created_at else None,
            photo_path=photo_path,
        )
        for slot, dose_log_id, result, created_at, photo_path in rows
    ]
    return sorted(doses, key=lambda dose: (dose.scheduled_at, dose.slot_id))
