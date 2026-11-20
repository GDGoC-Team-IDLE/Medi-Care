from datetime import date, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import GuardianAlertType, Slot
from app.main import app
from app.models import DoseSlot, Guardian, GuardianAlert, Patient, Prescription
from app.routers import alerts
from app.security import create_access_token


def test_alert_history_filters_and_orders_stored_alerts(monkeypatch):
    monkeypatch.setattr(get_settings(), "timezone", "Asia/Seoul")
    now = datetime(2026, 11, 20, 13, 0, 5)
    with TestClient(app) as client:
        with SessionLocal.begin() as db:
            owner, stranger = [
                Guardian(email=f"{uuid4().hex}@example.com", name="보호자", password_hash="unused")
                for _ in range(2)
            ]
            patient = Patient(name="복용자", guardian=owner)
            other_patient = Patient(name="다른 복용자", guardian=owner)
            prescription = Prescription(patient=patient, start_date=date(2026, 11, 18), days=6, ai_json={})
            slot = DoseSlot(
                patient=patient, prescription=prescription, slot_date=now.date(),
                slot=Slot.LUNCH, expected_count=1,
            )
            db.add_all([slot, other_patient, stranger])
            db.flush()
            patient_id = patient.id
            owner_id, stranger_id = owner.id, stranger.id
            prescription_id, slot_id = prescription.id, slot.id

            def add_alert(type_, created_at, **fields):
                alert = GuardianAlert(
                    type=type_, created_at=created_at, title="안내", body="알림 내용",
                    **{"patient_id": patient_id, "guardian_id": owner_id, **fields},
                )
                db.add(alert)
                return alert

            for index in range(100):
                add_alert(GuardianAlertType.MISSED, now - timedelta(minutes=index + 1))
            wrong = add_alert(GuardianAlertType.WRONG_DOSE, now, dose_slot_id=slot_id)
            low = add_alert(GuardianAlertType.MEDICATION_LOW, now, prescription_id=prescription_id)
            welfare = add_alert(
                GuardianAlertType.WELFARE_CHECK, now, dose_slot_id=slot_id, push_error="Expo unavailable",
            )
            add_alert(GuardianAlertType.DOSE_NO_RESPONSE, now, dose_slot_id=slot_id)
            add_alert(GuardianAlertType.MISSED, now, patient_id=other_patient.id)
            add_alert(GuardianAlertType.MISSED, now, guardian_id=stranger_id)
            db.flush()
            wrong_id, low_id, welfare_id = wrong.id, low.id, welfare.id
            other_id = other_patient.id

        headers = {"Authorization": f"Bearer {create_access_token(owner_id)}"}
        unauthorized = {"X-Device-Token": "device-only"}
        stranger_headers = {"Authorization": f"Bearer {create_access_token(stranger_id)}"}
        url = f"/api/v1/patients/{patient_id}/alerts"
        for status, request_headers, path, code, message in [
            (401, unauthorized, url, "UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
            (403, stranger_headers, url, "FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
            (404, headers, "/api/v1/patients/2147483647/alerts", "PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
        ]:
            response = client.get(path, headers=request_headers)
            assert response.status_code == status
            assert response.json() == {"code": code, "message": message}

        response = client.get(url, headers=headers)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        records = response.json()["alerts"]
        assert len(records) == 20
        assert records[0] == {
            "alert_id": welfare_id,
            "type": "WELFARE_CHECK",
            "title": "안내",
            "body": "알림 내용",
            "slot_id": slot_id,
            "prescription_id": None,
            "created_at": "2026-11-20T13:00:05+09:00",
        }
        assert records[1]["alert_id"] == low_id
        assert records[1]["prescription_id"] == prescription_id
        assert records[1]["slot_id"] is None
        assert records[2]["alert_id"] == wrong_id
        assert records[2]["type"] == "WRONG_DOSE"
        assert records[3]["type"] == "MISSED"
        capped = client.get(url, headers=headers, params={"limit": 101})
        assert capped.status_code == 200
        assert len(capped.json()["alerts"]) == 100
        assert client.get(url, headers=headers, params={"limit": 2}).json()["alerts"] == records[:2]
        assert len(client.get(f"/api/v1/patients/{other_id}/alerts", headers=headers).json()["alerts"]) == 1

        def fail(*args):
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(alerts, "select", fail)
        response = client.get(url, headers=headers)
        assert response.status_code == 500
        assert response.json() == {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했어요."}
