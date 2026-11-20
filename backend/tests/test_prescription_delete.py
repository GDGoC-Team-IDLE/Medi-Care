from datetime import date, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.enums import DoseStatus, GuardianAlertType, Slot, VerifyResult
from app.main import app
from app.models import (
    DoseLog,
    DoseSlot,
    Guardian,
    GuardianAlert,
    GuardianNotification,
    Patient,
    Prescription,
    PrescriptionDrug,
)
from app.security import create_access_token, token_hash

URL = "/api/v1/prescriptions/{}"
START = date(2026, 11, 20)
NOT_FOUND = {"code": "PRESCRIPTION_NOT_FOUND", "message": "약봉투 정보를 찾을 수 없어요."}


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def _seed(days: int = 2, slots: tuple[Slot, ...] = (Slot.MORNING, Slot.DINNER)) -> dict:
    """보호자·어르신과 처방 2건(지울 처방, 남겨 둘 처방)을 만듭니다."""
    device_token = uuid4().hex
    with SessionLocal() as db:
        guardian, other = [
            Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="보호자")
            for _ in range(2)
        ]
        patient = Patient(guardian=guardian, name="김순자", device_token=token_hash(device_token))
        target, kept = [
            Prescription(patient=patient, start_date=START, days=days, ai_json={}) for _ in range(2)
        ]
        db.add_all([guardian, other, patient, target, kept])
        for prescription in (target, kept):
            db.add(PrescriptionDrug(
                prescription=prescription, drug_name="예시약", count_per_dose=1, slots=[s.value for s in slots],
            ))
            for offset in range(days):
                for slot in slots:
                    db.add(DoseSlot(
                        prescription=prescription, patient=patient, slot_date=START + timedelta(days=offset),
                        slot=slot, expected_count=1,
                    ))
        db.flush()
        missed_slot = db.scalars(
            select(DoseSlot).where(DoseSlot.prescription_id == target.id).order_by(DoseSlot.id)
        ).first()
        missed_slot.status = DoseStatus.MISSED
        db.add_all([
            GuardianAlert(
                guardian=guardian, patient=patient, dose_slot_id=missed_slot.id,
                type=GuardianAlertType.MISSED, title="미복용", body="아침 약을 안 드셨어요.",
            ),
            GuardianAlert(
                guardian=guardian, patient=patient, prescription_id=target.id,
                type=GuardianAlertType.MEDICATION_LOW, title="약 소진", body="약이 곧 떨어져요.",
            ),
            GuardianNotification(
                prescription_id=target.id, depletion_date=START + timedelta(days=days),
                days_remaining=1, detected_at=datetime(2026, 11, 21, 9, 0),
            ),
        ])
        db.commit()
        slot_ids = list(db.scalars(
            select(DoseSlot.id).where(DoseSlot.prescription_id == target.id).order_by(DoseSlot.id)
        ))
        return {
            "rx_id": target.id,
            "kept_id": kept.id,
            "slot_ids": slot_ids,
            "device": {"X-Device-Token": device_token},
            "owner": {"Authorization": f"Bearer {create_access_token(guardian.id)}"},
            "other": {"Authorization": f"Bearer {create_access_token(other.id)}"},
        }


def _count(model, column, value) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model).where(column == value))


def _add_log(slot_id: int) -> None:
    with SessionLocal() as db:
        db.add(DoseLog(dose_slot_id=slot_id, photo_path="p.jpg", ai_json={}, result=VerifyResult.OK))
        db.commit()


def _assert_untouched(s: dict) -> None:
    assert _count(Prescription, Prescription.id, s["rx_id"]) == 1
    assert _count(DoseSlot, DoseSlot.prescription_id, s["rx_id"]) == len(s["slot_ids"])
    assert _count(PrescriptionDrug, PrescriptionDrug.prescription_id, s["rx_id"]) == 1


@pytest.mark.parametrize("who", ["owner", "device"])
def test_delete_prescription_removes_drugs_slots_and_alerts(client, who):
    s = _seed()

    response = client.delete(URL.format(s["rx_id"]), headers=s[who])

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {
        "prescription_id": s["rx_id"],
        "deleted_slot_ids": s["slot_ids"],
        "message": "약봉투 등록을 취소했어요.",
    }
    assert len(s["slot_ids"]) == 4  # 2일 × 아침·저녁
    assert _count(Prescription, Prescription.id, s["rx_id"]) == 0
    assert _count(PrescriptionDrug, PrescriptionDrug.prescription_id, s["rx_id"]) == 0
    assert _count(DoseSlot, DoseSlot.prescription_id, s["rx_id"]) == 0
    assert _count(GuardianNotification, GuardianNotification.prescription_id, s["rx_id"]) == 0
    assert _count(GuardianAlert, GuardianAlert.prescription_id, s["rx_id"]) == 0
    assert _count(GuardianAlert, GuardianAlert.dose_slot_id, s["slot_ids"][0]) == 0
    # 같은 어르신의 다른 처방은 그대로 둡니다.
    assert _count(Prescription, Prescription.id, s["kept_id"]) == 1
    assert _count(DoseSlot, DoseSlot.prescription_id, s["kept_id"]) == 4

    again = client.delete(URL.format(s["rx_id"]), headers=s[who])
    assert again.status_code == 404
    assert again.json() == NOT_FOUND


def test_delete_prescription_with_dose_log_is_conflict(client):
    s = _seed()
    _add_log(s["slot_ids"][-1])

    response = client.delete(URL.format(s["rx_id"]), headers=s["owner"])

    assert response.status_code == 409
    assert response.json() == {
        "code": "PRESCRIPTION_HAS_RECORDS",
        "message": "이미 복용 인증 기록이 있는 약봉투는 지울 수 없어요.",
    }
    _assert_untouched(s)


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer nope"}, {"X-Device-Token": "unknown-device"}],
)
def test_delete_prescription_requires_auth(client, headers):
    s = _seed()

    response = client.delete(URL.format(s["rx_id"]), headers=headers)

    assert response.status_code == 401
    assert response.json() == {"code": "UNAUTHORIZED", "message": "로그인 정보가 없어요. 다시 로그인해 주세요."}
    _assert_untouched(s)


def test_delete_prescription_of_unlinked_patient_is_forbidden(client):
    s = _seed()
    other_device = _seed()["device"]

    for headers in (s["other"], other_device):
        response = client.delete(URL.format(s["rx_id"]), headers=headers)
        assert response.status_code == 403
        assert response.json() == {"code": "FORBIDDEN", "message": "이 처방을 지울 권한이 없어요."}
    _assert_untouched(s)


@pytest.mark.parametrize("rx_id", ["999999999", "abc", "0", "99999999999"])
def test_delete_unknown_prescription_is_not_found(client, rx_id):
    s = _seed()

    response = client.delete(URL.format(rx_id), headers=s["owner"])

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
