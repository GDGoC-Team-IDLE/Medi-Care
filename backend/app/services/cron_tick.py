from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.dose_schedule import SLOT_TIMES
from app.enums import DoseStatus, GuardianAlertType, Slot, VerifyResult
from app.medication_notifications import TITLE, notification_body
from app.models import DoseLog, DoseSlot, GuardianAlert, GuardianNotification, Patient, Prescription, PushToken
from app.services.expo_push import ExpoPushError, send_expo_push

SLOT_NAMES = {
    Slot.MORNING: "아침",
    Slot.LUNCH: "점심",
    Slot.DINNER: "저녁",
    Slot.BEDTIME: "취침 전",
}
ALERT_TYPES = (GuardianAlertType.MISSED, GuardianAlertType.WELFARE_CHECK, GuardianAlertType.MEDICATION_LOW)


def _scheduled_by(cutoff: datetime):
    return or_(*(
        and_(
            DoseSlot.slot == slot,
            DoseSlot.slot_date <= cutoff.date() - timedelta(days=cutoff.time() < start),
        )
        for slot, start in SLOT_TIMES.items()
    ))


def _queue_alert(db: Session, alert: GuardianAlert, reservation: GuardianNotification | None = None) -> bool:
    key = alert.dedupe_key
    try:
        with db.begin_nested():
            db.add(alert)
            if reservation is not None:
                db.add(reservation)
    except IntegrityError:
        duplicate = db.scalar(select(GuardianAlert.id).where(GuardianAlert.dedupe_key == key))
        if duplicate is not None:
            return False
        if reservation is not None and db.scalar(select(GuardianNotification.id).where(
            GuardianNotification.prescription_id == alert.prescription_id
        )) is not None:
            return False
        raise
    return True


def _mark_missed(db: Session, now: datetime, grace_minutes: int) -> tuple[int, int]:
    rows = db.execute(
        update(DoseSlot)
        .where(DoseSlot.status == DoseStatus.PENDING, _scheduled_by(now - timedelta(minutes=grace_minutes)))
        .values(status=DoseStatus.MISSED)
        .returning(DoseSlot.id, DoseSlot.patient_id, DoseSlot.slot)
    ).all()
    if not rows:
        return 0, 0
    guardian_ids = dict(db.execute(
        select(Patient.id, Patient.guardian_id).where(Patient.id.in_({row.patient_id for row in rows}))
    ).all())
    skipped = 0
    for row in rows:
        label = SLOT_NAMES[row.slot]
        created = _queue_alert(db, GuardianAlert(
            patient_id=row.patient_id,
            guardian_id=guardian_ids[row.patient_id],
            dose_slot_id=row.id,
            dedupe_key=f"missed:{row.id}",
            type=GuardianAlertType.MISSED,
            title="미복용 안내",
            body=f"{label} 약을 아직 안 드셨어요.",
            created_at=now,
        ))
        skipped += not created
    return len(rows), skipped


def _queue_welfare_checks(db: Session, now: datetime, grace_minutes: int) -> int:
    slot_order = case({slot: order for order, slot in enumerate(SLOT_TIMES)}, value=DoseSlot.slot)
    recent_rounds = (
        select(
            DoseSlot.id,
            DoseSlot.patient_id,
            DoseSlot.slot_date,
            DoseSlot.slot,
            DoseSlot.status,
            func.dense_rank().over(
                partition_by=DoseSlot.patient_id,
                order_by=(DoseSlot.slot_date.desc(), slot_order.desc()),
            ).label("round_rank"),
        )
        .where(_scheduled_by(now - timedelta(minutes=grace_minutes)))
        .subquery()
    )
    last_two = defaultdict(list)
    for row in db.execute(
        select(recent_rounds, Patient.guardian_id)
        .join(Patient, Patient.id == recent_rounds.c.patient_id)
        .where(recent_rounds.c.round_rank <= 2)
        .order_by(recent_rounds.c.round_rank, recent_rounds.c.id)
    ):
        last_two[row.patient_id].append(row)
    candidates = {
        patient_id: rounds
        for patient_id, rounds in last_two.items()
        if rounds[-1].round_rank == 2 and all(row.status == DoseStatus.MISSED for row in rounds)
    }
    if not candidates:
        return 0

    last_ok = (
        select(
            DoseSlot.patient_id,
            DoseLog.id,
            DoseLog.created_at,
            func.row_number().over(
                partition_by=DoseSlot.patient_id,
                order_by=(DoseLog.created_at.desc(), DoseLog.id.desc()),
            ).label("log_rank"),
        )
        .join(DoseSlot, DoseSlot.id == DoseLog.dose_slot_id)
        .where(
            DoseSlot.patient_id.in_(candidates),
            DoseLog.result == VerifyResult.OK,
            DoseLog.created_at <= now,
        )
        .subquery()
    )
    verifications = {
        row.patient_id: row for row in db.execute(select(last_ok).where(last_ok.c.log_rank == 1))
    }
    skipped = 0
    for patient_id, rounds in candidates.items():
        newest, oldest = rounds[0], rounds[-1]
        verification = verifications.get(patient_id)
        # 성공 인증 이후의 회차 두 개가 연속으로 미복용이어야 다시 안내합니다.
        if verification and datetime.combine(oldest.slot_date, SLOT_TIMES[oldest.slot]) <= verification.created_at:
            continue
        created = _queue_alert(db, GuardianAlert(
            patient_id=patient_id,
            guardian_id=newest.guardian_id,
            dose_slot_id=newest.id,
            dedupe_key=f"welfare:{patient_id}:{verification.id if verification else 0}",
            type=GuardianAlertType.WELFARE_CHECK,
            title="안부 확인",
            body="약 알림에 반응이 없어요. 안부를 확인해 주세요.",
            created_at=now,
        ))
        skipped += not created
    return skipped


def _queue_medication_low(db: Session, now: datetime, warning_days: int) -> int:
    rows = db.execute(
        select(Prescription.id, Prescription.start_date, Prescription.days, Patient.id, Patient.guardian_id)
        .join(Patient, Patient.id == Prescription.patient_id)
        .where(Prescription.start_date <= now.date(), Prescription.days > 0)
    ).all()
    skipped = 0
    for prescription_id, start_date, days, patient_id, guardian_id in rows:
        remaining = days - 1 - (now.date() - start_date).days
        if not 0 <= remaining <= warning_days:
            continue
        created = _queue_alert(
            db,
            GuardianAlert(
                patient_id=patient_id,
                guardian_id=guardian_id,
                prescription_id=prescription_id,
                dedupe_key=f"medication-low:{prescription_id}",
                type=GuardianAlertType.MEDICATION_LOW,
                title=TITLE,
                body=notification_body(remaining),
                created_at=now,
            ),
            # 기존 내부 알림 API와도 처방당 한 번만 전송하도록 같은 고유 예약을 사용합니다.
            GuardianNotification(
                prescription_id=prescription_id,
                depletion_date=start_date + timedelta(days=days - 1),
                days_remaining=remaining,
                detected_at=now,
                created_at=now,
                status="SENDING",
            ),
        )
        skipped += not created
    return skipped


def _send_pending(db: Session, now: datetime) -> dict[str, int]:
    counts = {event_type.value: 0 for event_type in ALERT_TYPES}
    ids = db.scalars(select(GuardianAlert.id).where(
        GuardianAlert.type.in_(ALERT_TYPES),
        GuardianAlert.dedupe_key.is_not(None),
        GuardianAlert.push_attempted_at.is_(None),
        GuardianAlert.push_sent_at.is_(None),
    ).order_by(GuardianAlert.id)).all()
    for alert_id in ids:
        alert = db.get(GuardianAlert, alert_id)
        if alert is None:
            continue
        tokens = list(db.scalars(select(PushToken.expo_token).where(PushToken.guardian_id == alert.guardian_id)))
        claim = db.execute(update(GuardianAlert).where(
            GuardianAlert.id == alert_id,
            GuardianAlert.push_attempted_at.is_(None),
            GuardianAlert.push_sent_at.is_(None),
        ).values(push_attempted_at=now))
        db.commit()
        if claim.rowcount != 1:
            continue
        try:
            if tokens:
                result = send_expo_push(
                    tokens,
                    title=alert.title,
                    body=alert.body,
                    data={
                        "type": alert.type.value,
                        "alert_id": alert.id,
                        "patient_id": alert.patient_id,
                        "slot_id": alert.dose_slot_id,
                        "prescription_id": alert.prescription_id,
                    },
                )
            else:
                raise ExpoPushError("등록된 Expo 토큰이 없습니다.")
        except ExpoPushError as exc:
            # Expo가 요청을 받았을 수 있으므로 응답이 유실된 푸시를 반복하지 않습니다.
            alert.push_error = str(exc)[:500]
        else:
            alert.push_error = ", ".join(result.errors)[:500] or None
            if result.accepted:
                counts[alert.type.value] += 1
                alert.push_sent_at = now
            if result.invalid_tokens:
                db.execute(delete(PushToken).where(
                    PushToken.guardian_id == alert.guardian_id,
                    PushToken.expo_token.in_(result.invalid_tokens),
                ))
        if alert.prescription_id is not None:
            db.execute(update(GuardianNotification).where(
                GuardianNotification.prescription_id == alert.prescription_id,
                GuardianNotification.status == "SENDING",
            ).values(status="SENT" if alert.push_sent_at else "FAILED"))
        db.commit()
    return counts


def run_tick(db: Session, now: datetime, settings: Settings) -> tuple[int, dict[str, int], int]:
    missed, skipped = _mark_missed(db, now, settings.missed_after_minutes)
    skipped += _queue_welfare_checks(db, now, settings.missed_after_minutes)
    skipped += _queue_medication_low(db, now, settings.medication_low_days)
    db.commit()
    return missed, _send_pending(db, now), skipped
