from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.database import SessionLocal
from app.enums import DoseStatus, Slot
from app.main import app
from app.models import DoseSlot, PairAttempt, Prescription
from app.services.expo_push import ExpoPushResult


def _create_devices_and_slot(client: TestClient):
    email = f"notifications-{uuid4().hex}@example.com"
    password = "TestPassword123!"
    signup = client.post(
        "/api/v1/auth/signup",
        json={"user_email": email, "password": password, "user_nickname": "보호자"},
    )
    assert signup.status_code == 201
    login = client.post(
        "/api/v1/auth/login",
        json={"user_email": email, "password": password},
    )
    guardian_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    patient = client.post(
        "/api/v1/patients", json={"name": "어머니"}, headers=guardian_headers
    )
    patient_id = patient.json()["patient_id"]
    pairing = client.post(
        f"/api/v1/patients/{patient_id}/pairing-code", headers=guardian_headers
    )
    # 다른 테스트의 IP별 연결 시도 횟수가 이 기능 테스트에 영향을 주지 않게 격리합니다.
    with SessionLocal() as db:
        db.execute(delete(PairAttempt))
        db.commit()
    paired = client.post(
        "/api/v1/devices/pair", json={"code": pairing.json()["pairing_code"]}
    )
    device_headers = {"X-Device-Token": paired.json()["device_token"]}

    with SessionLocal() as db:
        prescription = Prescription(
            patient_id=patient_id,
            start_date=date.today(),
            days=1,
            image_path=None,
            ai_json={},
        )
        db.add(prescription)
        db.flush()
        dose_slot = DoseSlot(
            prescription_id=prescription.id,
            patient_id=patient_id,
            slot_date=date.today(),
            slot=Slot.LUNCH,
            expected_count=2,
        )
        db.add(dose_slot)
        db.commit()
        slot_id = dose_slot.id

    return guardian_headers, device_headers, slot_id


def test_register_push_token_and_send_no_response_once(monkeypatch):
    calls: list[list[str]] = []

    def fake_send(tokens, **_kwargs):
        calls.append(tokens)
        return ExpoPushResult(accepted=len(tokens))

    monkeypatch.setattr("app.routers.notifications.send_expo_push", fake_send)

    with TestClient(app) as client:
        guardian_headers, device_headers, slot_id = _create_devices_and_slot(client)
        registered = client.post(
            "/api/v1/push-tokens",
            headers=guardian_headers,
            json={"expo_token": "ExponentPushToken[test-device-token-123456]"},
        )
        assert registered.status_code == 200

        first = client.post(
            f"/api/v1/patients/me/dose-slots/{slot_id}/no-response",
            headers=device_headers,
        )
        assert first.status_code == 200
        assert first.json()["duplicate"] is False
        assert first.json()["push"]["status"] == "SENT"

        duplicate = client.post(
            f"/api/v1/patients/me/dose-slots/{slot_id}/no-response",
            headers=device_headers,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["duplicate"] is True
        assert len(calls) == 1


def test_no_response_rejects_completed_slot(monkeypatch):
    monkeypatch.setattr(
        "app.routers.notifications.send_expo_push",
        lambda *_args, **_kwargs: ExpoPushResult(),
    )
    with TestClient(app) as client:
        _, device_headers, slot_id = _create_devices_and_slot(client)
        with SessionLocal() as db:
            dose_slot = db.get(DoseSlot, slot_id)
            dose_slot.status = DoseStatus.DONE
            db.commit()

        response = client.post(
            f"/api/v1/patients/me/dose-slots/{slot_id}/no-response",
            headers=device_headers,
        )
        assert response.status_code == 409


def test_no_response_stays_pending_without_guardian_token(monkeypatch):
    monkeypatch.setattr(
        "app.routers.notifications.send_expo_push",
        lambda *_args, **_kwargs: ExpoPushResult(),
    )
    with TestClient(app) as client:
        _, device_headers, slot_id = _create_devices_and_slot(client)

        first = client.post(
            f"/api/v1/patients/me/dose-slots/{slot_id}/no-response",
            headers=device_headers,
        )
        second = client.post(
            f"/api/v1/patients/me/dose-slots/{slot_id}/no-response",
            headers=device_headers,
        )

        assert first.status_code == 200
        assert first.json()["push"]["status"] == "PENDING"
        assert second.status_code == 200
        assert second.json()["duplicate"] is True


def test_push_token_validation():
    with TestClient(app) as client:
        guardian_headers, _, _ = _create_devices_and_slot(client)
        response = client.post(
            "/api/v1/push-tokens",
            headers=guardian_headers,
            json={"expo_token": "not-an-expo-token"},
        )
        assert response.status_code == 400
