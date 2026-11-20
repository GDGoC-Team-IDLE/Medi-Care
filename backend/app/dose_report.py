from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.dur import DurWarning, active_dur_warnings
from app.enums import DoseStatus, MealTiming, Slot, VerifyResult
from app.models import DoseLog, DoseSlot, Prescription, PrescriptionDrug

WRONG_MESSAGES = {
    VerifyResult.COUNT_MISMATCH: "알약 개수가 등록된 개수와 달랐어요.",
    VerifyResult.APPEARANCE_MISMATCH: "등록된 약과 알약 색·모양이 달랐어요.",
    VerifyResult.WRONG_TIME: "등록된 복용 시간과 달랐어요.",
    VerifyResult.ALREADY_TAKEN: "이미 인증한 회차의 약을 다시 인증하려고 했어요.",
}


@dataclass(frozen=True)
class Medication:
    prescription_id: int
    start_date: date
    end_date: date
    name: str
    count_per_dose: int
    slots: list[Slot]
    meal_timing: MealTiming


@dataclass(frozen=True)
class SlotAdherence:
    slot: Slot
    total: int
    done: int
    rate: float


@dataclass(frozen=True)
class Adherence:
    total: int
    done: int
    missed: int
    wrong: int
    adherence_rate: float
    by_slot: list[SlotAdherence]


@dataclass(frozen=True)
class MissedSummary:
    most_missed_slot: Slot | None
    missed_count: int


@dataclass(frozen=True)
class WrongRecord:
    date: date
    slot: Slot
    result: VerifyResult
    message: str


def current_medications(
    db: Session, patient_id: int, today: date
) -> tuple[list[Medication], list[DurWarning]]:
    prescriptions = db.execute(
        select(Prescription.id, Prescription.start_date, Prescription.days)
        .where(Prescription.patient_id == patient_id, Prescription.start_date <= today)
    )
    active = {
        rx.id: (rx.start_date, rx.start_date + timedelta(days=rx.days - 1))
        for rx in prescriptions
        if 0 <= (today - rx.start_date).days < rx.days
    }
    if not active:
        return [], []

    drugs = db.scalars(
        select(PrescriptionDrug)
        .where(PrescriptionDrug.prescription_id.in_(active))
        .options(joinedload(PrescriptionDrug.drug_info))
        .order_by(PrescriptionDrug.prescription_id, PrescriptionDrug.id)
    ).all()
    medications = []
    for drug in sorted(drugs, key=lambda drug: active[drug.prescription_id][0]):
        start_date, end_date = active[drug.prescription_id]
        medications.append(Medication(
            prescription_id=drug.prescription_id,
            start_date=start_date,
            end_date=end_date,
            name=drug.drug_name,
            count_per_dose=drug.count_per_dose,
            slots=[Slot(slot) for slot in drug.slots],
            meal_timing=drug.meal_timing,
        ))
    return medications, active_dur_warnings(drugs)


def _rate(done: int, total: int) -> float:
    return round(100 * done / total, 2) if total else 0.0


def adherence_for_period(
    db: Session, patient_id: int, start_date: date, end_date: date
) -> tuple[Adherence, MissedSummary]:
    rows = db.execute(
        select(DoseSlot.slot, DoseSlot.status, func.count())
        .where(
            DoseSlot.patient_id == patient_id,
            DoseSlot.slot_date.between(start_date, end_date),
            DoseSlot.status != DoseStatus.PENDING,
        )
        .group_by(DoseSlot.slot, DoseSlot.status)
    )
    by_slot: dict[Slot, Counter[DoseStatus]] = {slot: Counter() for slot in Slot}
    totals: Counter[DoseStatus] = Counter()
    for slot, status, count in rows:
        by_slot[slot][status] = count
        totals[status] += count

    rates = [
        SlotAdherence(slot, counts.total(), counts[DoseStatus.DONE], _rate(counts[DoseStatus.DONE], counts.total()))
        for slot, counts in by_slot.items()
        if counts
    ]
    done = totals[DoseStatus.DONE]
    total = totals.total()
    most_missed = max(Slot, key=lambda slot: by_slot[slot][DoseStatus.MISSED])
    missed_count = by_slot[most_missed][DoseStatus.MISSED]
    return (
        Adherence(total, done, totals[DoseStatus.MISSED], totals[DoseStatus.WRONG], _rate(done, total), rates),
        MissedSummary(most_missed if missed_count else None, missed_count),
    )


def wrong_records_for_period(
    db: Session, patient_id: int, start_date: date, end_date: date
) -> list[WrongRecord]:
    rows = db.execute(
        select(DoseLog.created_at, DoseSlot.slot, DoseLog.result)
        .join(DoseSlot, DoseSlot.id == DoseLog.dose_slot_id)
        .where(
            DoseSlot.patient_id == patient_id,
            DoseLog.created_at >= datetime.combine(start_date, time.min),
            DoseLog.created_at < datetime.combine(end_date + timedelta(days=1), time.min),
            DoseLog.result.in_(WRONG_MESSAGES),
        )
        .order_by(DoseLog.created_at.desc(), DoseLog.id.desc())
    )
    return [
        WrongRecord(created_at.date(), slot, result, WRONG_MESSAGES[result])
        for created_at, slot, result in rows
    ]
