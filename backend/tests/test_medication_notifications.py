import json
from datetime import date
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import medication_notifications
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.main import app
from app.models import Guardian, GuardianNotification, Patient, Prescription, PushToken
from app.routers import notifications

URL = "/api/v1/notifications/guardian/"
AUTH = {"Authorization": "Bearer internal-test"}


@pytest.fixture
def notification_request(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "internal_token", "internal-test")
    monkeypatch.setattr(settings, "expo_access_token", "expo-test")
    monkeypatch.setattr(settings, "timezone", "Asia/Seoul")
    expo_token = f"ExponentPushToken[{uuid4().hex}]"

    with TestClient(app) as client:
        with SessionLocal() as db:
            guardian = Guardian(email=f"{uuid4().hex}@example.com", password_hash="test", name="보호자")
            patient = Patient(guardian=guardian, name="김순자")
            prescription = Prescription(patient=patient, start_date=date(2026, 11, 13), days=10, ai_json={})
            db.add_all([prescription, PushToken(guardian=guardian, expo_token=expo_token)])
            db.commit()
            data = {
                "patient_id": patient.id,
                "prescription_id": prescription.id,
                "event_type": "MEDICATION_LOW",
                "source": "APSCHEDULER",
                "depletion_date": "2026-11-23",
                "days_remaining": 3,
                "detected_at": "2026-11-19T16:00:00Z",  # 서울 기준 11월 20일
            }
        yield client, data, expo_token


def test_notification_is_queued_once_and_uses_guardian_expo_token(notification_request, monkeypatch):
    client, data, expo_token = notification_request
    sent = []

    def send(request, *, timeout):
        assert request.full_url == medication_notifications.EXPO_SEND_URL
        assert request.get_header("Authorization") == "Bearer expo-test"
        sent.extend(json.loads(request.data))
        return BytesIO(b'{"data":[{"status":"ok","id":"test-ticket"}]}')

    monkeypatch.setattr(medication_notifications, "urlopen", send)
    created = client.post(URL, headers=AUTH, json=data)
    assert created.status_code == 202
    info = created.json()["data"]
    assert info["status"] == "QUEUED"
    assert info["depletion_date"] == "2026-11-23"
    assert info["created_at"].endswith("+09:00")
    assert info["title"] == "약 소진 예정 안내"
    assert info["body"] == "약이 3일 후 소진될 예정이에요. 병원 예약을 준비해 주세요."
    assert [message["to"] for message in sent] == [expo_token]
    assert sent[0]["data"]["notification_id"] == info["notification_id"]
    assert sent[0]["body"] == info["body"]

    duplicate = client.post(URL, headers=AUTH, json=data)
    assert duplicate.status_code == 200
    assert duplicate.json() == {
        "success": True,
        "data": {
            "patient_id": data["patient_id"],
            "prescription_id": data["prescription_id"],
            "event_type": "MEDICATION_LOW",
            "status": "ALREADY_SENT",
            "message": "이미 약 소진 알림이 전송되었습니다.",
        },
    }
    assert len(sent) == 1
    with SessionLocal() as db:
        alert = db.get(GuardianNotification, info["notification_id"])
        assert alert.status == "SENT"
        assert alert.detected_at.isoformat() == "2026-11-20T01:00:00"


def test_notification_rejects_invalid_or_unauthorized_requests(notification_request, monkeypatch):
    client, data, _ = notification_request
    cases = [
        (client.post(URL, json=data), 401, "UNAUTHORIZED"),
        (client.post(URL, headers=AUTH, json={**data, "patient_id": 2_147_483_647}), 404, "PRESCRIPTION_NOT_FOUND"),
        (client.post(URL, headers=AUTH, json={**data, "days_remaining": 4}), 400, "INVALID_REQUEST"),
        (client.post(URL, headers=AUTH, json={**data, "depletion_date": "2026-11-24"}), 400, "INVALID_REQUEST"),
        (client.post(URL, headers=AUTH, json={**data, "detected_at": "2026-11-20T09:00:00"}), 400, "INVALID_REQUEST"),
        (client.post(URL, headers=AUTH, json={**data, "source": "OTHER"}), 400, "INVALID_REQUEST"),
        (client.post(URL, headers={**AUTH, "Content-Type": "application/json"}, content="{"), 400, "INVALID_REQUEST"),
    ]
    for response, status, code in cases:
        assert response.status_code == status
        assert response.json()["success"] is False
        assert response.json()["error"]["code"] == code
    with SessionLocal() as db:
        assert db.scalar(select(GuardianNotification.id).where(
            GuardianNotification.prescription_id == data["prescription_id"]
        )) is None

    def fail(*args):
        raise RuntimeError("database is unavailable")

    monkeypatch.setattr(notifications, "queue_medication_low", fail)
    response = client.post(URL, headers=AUTH, json=data)
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_SERVER_ERROR"
