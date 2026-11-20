from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.enums import DoseStatus, GuardianAlertType, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, Guardian, GuardianAlert, Patient, Prescription, PushToken
from app.routers import internal
from app.services import cron_tick
from app.services.expo_push import ExpoPushResult

URL = "/api/v1/internal/tick"
AUTH = {"X-Cron-Secret": "test-cron-secret"}


@pytest.fixture
def cron_app(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'cron.db'}", connect_args={"check_same_thread": False})
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_db():
        with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    settings = get_settings()
    monkeypatch.setattr(settings, "cron_secret", AUTH["X-Cron-Secret"])
    monkeypatch.setattr(settings, "timezone", "Asia/Seoul")
    monkeypatch.setattr(settings, "missed_after_minutes", 60)
    monkeypatch.setattr(settings, "medication_low_days", 3)
    with TestClient(app) as client:
        yield client, sessions
    engine.dispose()


def test_tick_sends_each_alert_once_and_resets_welfare_after_ok(cron_app, monkeypatch):
    client, sessions = cron_app
    now = datetime(2026, 11, 20, 13, 40)
    monkeypatch.setattr(internal, "now_local", lambda: now)
    pushes = []

    def send(tokens, *, title, body, data):
        assert tokens == ["ExponentPushToken[test]"]
        pushes.append((data["type"], body))
        return ExpoPushResult(accepted=1)

    monkeypatch.setattr(cron_tick, "send_expo_push", send)
    with sessions.begin() as db:
        guardian = Guardian(email="guardian@example.com", password_hash="unused", name="보호자")
        patient = Patient(guardian=guardian, name="김순자")
        prescription = Prescription(patient=patient, start_date=date(2026, 11, 14), days=10, ai_json={})
        db.add_all([prescription, PushToken(guardian=guardian, expo_token="ExponentPushToken[test]")])
        db.flush()
        slots = {}
        for day, slot in [
            (20, Slot.MORNING), (20, Slot.LUNCH), (20, Slot.DINNER),
            (21, Slot.MORNING), (21, Slot.LUNCH),
        ]:
            entry = DoseSlot(
                patient_id=patient.id, prescription=prescription, slot_date=date(2026, 11, day),
                slot=slot, expected_count=1,
            )
            db.add(entry)
            slots[day, slot] = entry
        db.flush()
        dinner_id = slots[20, Slot.DINNER].id
        prescription_id = prescription.id

    for headers in ({}, {"X-Cron-Secret": "wrong"}):
        unauthorized = client.post(URL, headers=headers)
        assert unauthorized.status_code == 401
        assert unauthorized.json()["code"] == "INVALID_CRON_SECRET"
    assert pushes == []

    first = client.post(URL, headers=AUTH)
    assert first.status_code == 200
    assert first.json() == {
        "ran_at": "2026-11-20T13:40:00+09:00",
        "missed_marked": 2,
        "alerts_sent": {"MISSED": 2, "WELFARE_CHECK": 1, "MEDICATION_LOW": 1},
        "skipped_duplicates": 0,
    }
    assert ("MISSED", "점심 약을 아직 안 드셨어요.") in pushes
    assert ("WELFARE_CHECK", "약 알림에 반응이 없어요. 안부를 확인해 주세요.") in pushes
    assert ("MEDICATION_LOW", "약이 3일 후 소진될 예정이에요. 병원 예약을 준비해 주세요.") in pushes

    again = client.post(URL, headers=AUTH).json()
    assert again["missed_marked"] == 0
    assert again["alerts_sent"] == {"MISSED": 0, "WELFARE_CHECK": 0, "MEDICATION_LOW": 0}
    assert again["skipped_duplicates"] == 2

    with sessions.begin() as db:
        dinner = db.get(DoseSlot, dinner_id)
        assert dinner.status == DoseStatus.PENDING

    now = datetime(2026, 11, 20, 19, 40)
    continuing = client.post(URL, headers=AUTH).json()
    assert continuing["alerts_sent"] == {"MISSED": 1, "WELFARE_CHECK": 0, "MEDICATION_LOW": 0}
    with sessions.begin() as db:
        dinner = db.get(DoseSlot, dinner_id)
        assert dinner.status == DoseStatus.MISSED
        dinner.status = DoseStatus.DONE
        db.add(DoseLog(
            dose_slot=dinner, result=VerifyResult.OK, photo_path="ok.jpg", ai_json={},
            created_at=datetime(2026, 11, 20, 19, 45),
        ))

    now = datetime(2026, 11, 21, 13, 40)
    after_ok = client.post(URL, headers=AUTH).json()
    assert after_ok["alerts_sent"] == {"MISSED": 2, "WELFARE_CHECK": 1, "MEDICATION_LOW": 0}
    with sessions() as db:
        alerts = db.scalars(select(GuardianAlert)).all()
        assert len(alerts) == 8
        assert all(alert.push_sent_at is not None for alert in alerts)
        low = next(alert for alert in alerts if alert.type == GuardianAlertType.MEDICATION_LOW)
        assert low.prescription_id == prescription_id
        assert low.dose_slot_id is None


def test_tick_uses_configured_grace_and_returns_server_error(cron_app, monkeypatch):
    client, sessions = cron_app
    now = datetime(2026, 11, 20, 13, 40)
    monkeypatch.setattr(internal, "now_local", lambda: now)
    monkeypatch.setattr(get_settings(), "missed_after_minutes", 90)
    monkeypatch.setattr(get_settings(), "medication_low_days", 1)
    with sessions.begin() as db:
        guardian = Guardian(email="owner@example.com", password_hash="unused", name="보호자")
        patient = Patient(guardian=guardian, name="김순자")
        prescription = Prescription(patient=patient, start_date=date(2026, 11, 14), days=10, ai_json={})
        db.add(prescription)
        db.flush()
        db.add(DoseSlot(
            patient_id=patient.id, prescription=prescription, slot_date=now.date(),
            slot=Slot.LUNCH, expected_count=1,
        ))
    response = client.post(URL, headers=AUTH)
    assert response.status_code == 200
    assert response.json()["missed_marked"] == 0
    with sessions() as db:
        assert db.scalars(select(GuardianAlert)).first() is None

    def fail(*args):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(internal, "run_tick", fail)
    error = client.post(URL, headers=AUTH)
    assert error.status_code == 500
    assert error.json() == {"code": "INTERNAL_ERROR", "message": "주기 작업 처리 중 오류가 발생했어요."}
