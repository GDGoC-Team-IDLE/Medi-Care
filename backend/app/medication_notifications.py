import json
import logging
from datetime import date, datetime, timedelta
from urllib.request import Request, urlopen

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models import GuardianNotification, Patient, Prescription, PushToken

logger = logging.getLogger(__name__)
EVENT_TYPE = "MEDICATION_LOW"
TITLE = "약 소진 예정 안내"
EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send"
EXPO_BATCH_SIZE = 100


def depletion_date(prescription: Prescription) -> date:
    # 복용 시작일을 첫 복용일로 보고, 마지막 복용일의 다음 날을 소진 예정일로 계산합니다.
    return prescription.start_date + timedelta(days=prescription.days)


def notification_body(days_remaining: int) -> str:
    when = f"{days_remaining}일 후" if days_remaining else "오늘"
    return f"약이 {when} 소진될 예정이에요. 병원 예약을 준비해 주세요."


def queue_medication_low(
    db: Session, prescription_id: int, run_out_on: date, days_remaining: int, detected_at: datetime
) -> tuple[GuardianNotification, bool]:
    notification = GuardianNotification(
        prescription_id=prescription_id,
        depletion_date=run_out_on,
        days_remaining=days_remaining,
        detected_at=detected_at,
    )
    db.add(notification)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(GuardianNotification).where(
            GuardianNotification.prescription_id == prescription_id
        ))
        if existing is None:
            raise
        return existing, False
    return notification, True


def _send_expo(tokens: list[str], notification: GuardianNotification, patient_id: int) -> bool:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token := get_settings().expo_access_token:
        headers["Authorization"] = f"Bearer {token}"

    payload = {
        "title": TITLE,
        "body": notification_body(notification.days_remaining),
        "data": {
            "notification_id": notification.id,
            "event_type": EVENT_TYPE,
            "patient_id": patient_id,
            "prescription_id": notification.prescription_id,
            "depletion_date": notification.depletion_date.isoformat(),
        },
    }
    accepted = True
    for start in range(0, len(tokens), EXPO_BATCH_SIZE):
        messages = [{"to": token, **payload} for token in tokens[start:start + EXPO_BATCH_SIZE]]
        request = Request(EXPO_SEND_URL, json.dumps(messages).encode(), headers, method="POST")
        with urlopen(request, timeout=10) as response:
            tickets = json.load(response)["data"]
        if isinstance(tickets, dict):
            tickets = [tickets]
        if len(tickets) != len(messages) or any(ticket.get("status") != "ok" for ticket in tickets):
            accepted = False
    return accepted


def deliver_medication_low(notification_id: int) -> None:
    try:
        with SessionLocal() as db:
            notification = db.get(GuardianNotification, notification_id)
            if notification is None or notification.status != "QUEUED":
                return
            recipient = db.execute(
                select(Patient.id, Patient.guardian_id)
                .join(Prescription, Prescription.patient_id == Patient.id)
                .where(Prescription.id == notification.prescription_id)
            ).one_or_none()
            if recipient is None:
                return
            tokens = list(db.scalars(select(PushToken.expo_token).where(
                PushToken.guardian_id == recipient.guardian_id
            )))
            if not tokens:
                return
            claimed = db.execute(
                update(GuardianNotification)
                .where(GuardianNotification.id == notification_id, GuardianNotification.status == "QUEUED")
                .values(status="SENDING")
            ).rowcount
            db.commit()
            if claimed != 1:
                return

        status = "FAILED"
        try:
            if _send_expo(tokens, notification, recipient.id):
                status = "SENT"
            else:
                logger.warning("Expo rejected medication notification %s", notification_id)
        except Exception:
            # 응답 유실 시 푸시가 수락됐을 수 있으므로 동일 요청을 재전송하지 않습니다.
            logger.warning("Could not confirm Expo medication notification %s", notification_id)

        with SessionLocal.begin() as db:
            db.execute(update(GuardianNotification).where(
                GuardianNotification.id == notification_id
            ).values(status=status))
    except Exception:
        logger.exception("Could not process medication notification %s", notification_id)
