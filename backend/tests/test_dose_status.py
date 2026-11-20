import json
from datetime import date, datetime
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core import photo_storage
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import DoseStatus, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, Guardian, Patient, Prescription
from app.routers import dose_status
from app.security import create_access_token, token_hash

STATUS_URL = "/api/v1/patients/{}/status"
STATUS_DATE = date(2026, 11, 20)
STORAGE_URL = "https://storage.example.com/storage/v1"


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def patient_auth(client):
    device_token = uuid4().hex
    with SessionLocal() as db:
        guardian = Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="보호자")
        other = Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="다른 보호자")
        patient = Patient(guardian=guardian, name="김순자", device_token=token_hash(device_token))
        db.add_all([patient, other])
        db.commit()
        return (
            patient.id,
            {"X-Device-Token": device_token},
            {"Authorization": f"Bearer {create_access_token(guardian.id)}"},
            {"Authorization": f"Bearer {create_access_token(other.id)}"},
        )


def test_today_status_preserves_original_verification_and_signs_photos(client, patient_auth, monkeypatch):
    patient_id, device, guardian, _ = patient_auth
    monkeypatch.setattr(dose_status, "now_local", lambda: datetime(2026, 11, 20, 23, 59))
    settings = get_settings()
    monkeypatch.setattr(settings, "timezone", "Asia/Seoul")
    monkeypatch.setattr(settings, "supabase_url", "https://storage.example.com")
    monkeypatch.setattr(settings, "supabase_bucket", "dose-photos")
    monkeypatch.setattr(settings, "supabase_service_role_key", "test-key")

    def sign(request, timeout):
        assert request.method == "POST"
        assert request.full_url == f"{STORAGE_URL}/object/sign/dose-photos"
        assert request.get_header("Authorization") == "Bearer test-key"
        assert request.get_header("Apikey") == "test-key"
        assert json.loads(request.data) == {
            "paths": ["501.jpg", "502.jpg", "503.jpg"],
            "expiresIn": 300,
        }
        return BytesIO(json.dumps([
            {"path": "501.jpg", "signedURL": "/object/sign/dose-photos/501.jpg?token=photo-1"},
            {"path": "502.jpg", "signedURL": "/object/sign/dose-photos/502.jpg?token=photo-2"},
            {"path": "503.jpg", "signedURL": None, "error": "Object not found"},
        ]).encode())

    monkeypatch.setattr(photo_storage, "urlopen", sign)
    with SessionLocal() as db:
        prescription = Prescription(patient_id=patient_id, start_date=STATUS_DATE, days=2, ai_json={})
        slots = {
            slot: DoseSlot(
                prescription=prescription,
                patient_id=patient_id,
                slot_date=STATUS_DATE,
                slot=slot,
                expected_count=count,
                status=status,
            )
            for slot, count, status in (
                (Slot.DINNER, 2, DoseStatus.PENDING),
                (Slot.LUNCH, 1, DoseStatus.DONE),
                (Slot.MORNING, 2, DoseStatus.DONE),
                (Slot.BEDTIME, 1, DoseStatus.WRONG),
            )
        }
        tomorrow = DoseSlot(
            prescription=prescription,
            patient_id=patient_id,
            slot_date=date(2026, 11, 21),
            slot=Slot.MORNING,
            expected_count=2,
            status=DoseStatus.MISSED,
        )
        db.add_all([*slots.values(), tomorrow])
        db.add_all([
            DoseLog(
                dose_slot=slots[slot],
                photo_path=path,
                ai_json={},
                result=result,
                created_at=datetime(2026, 11, 20, hour, minute),
            )
            for slot, path, result, hour, minute in (
                (Slot.MORNING, "501.jpg", VerifyResult.OK, 8, 5),
                (Slot.MORNING, "retry.jpg", VerifyResult.ALREADY_TAKEN, 8, 27),
                (Slot.LUNCH, "502.jpg", VerifyResult.OK, 12, 31),
                (Slot.BEDTIME, "503.jpg", VerifyResult.COUNT_MISMATCH, 22, 4),
            )
        ])
        db.commit()
        morning_id = slots[Slot.MORNING].id
        dinner_id = slots[Slot.DINNER].id

    # 양쪽 토큰이 저장된 앱에서도 경로에 맞는 인증을 사용합니다.
    me = client.get(STATUS_URL.format("me"), headers={**device, "Authorization": "Bearer invalid"})
    owned = client.get(STATUS_URL.format(patient_id), headers={**guardian, "X-Device-Token": "invalid"})
    assert me.status_code == owned.status_code == 200
    assert me.headers["cache-control"] == "no-store"
    data = me.json()
    assert data == owned.json()
    assert data["patient_id"] == patient_id
    assert data["patient_name"] == "김순자"
    assert data["date"] == "2026-11-20"
    assert data["summary"] == {"total": 4, "done": 2, "pending": 1, "missed": 0, "wrong": 1}
    assert data["voice_message"] == (
        "아침 약은 8시 5분에, 점심 약은 12시 31분에 드셨어요. "
        "저녁 약은 아직 안 드셨어요. 취침 전 약은 인증 결과를 확인해 주세요."
    )
    morning, lunch, dinner, bedtime = data["slots"]
    assert morning == {
        "slot_id": morning_id,
        "slot": "MORNING",
        "scheduled_at": "2026-11-20T08:00:00+09:00",
        "expected_count": 2,
        "status": "DONE",
        "result": "OK",
        "taken_at": "2026-11-20T08:05:00+09:00",
        "photo_url": f"{STORAGE_URL}/object/sign/dose-photos/501.jpg?token=photo-1",
        "can_verify": False,
        "duplicate_warning": "이미 드신 약이에요",
    }
    assert lunch["slot"] == "LUNCH"
    assert dinner == {
        "slot_id": dinner_id,
        "slot": "DINNER",
        "scheduled_at": "2026-11-20T18:30:00+09:00",
        "expected_count": 2,
        "status": "PENDING",
        "result": None,
        "taken_at": None,
        "photo_url": None,
        "can_verify": True,
        "duplicate_warning": None,
    }
    assert bedtime["slot"] == "BEDTIME"
    assert bedtime["taken_at"] == "2026-11-20T22:04:00+09:00"
    assert bedtime["photo_url"] is None
    assert bedtime["can_verify"] is True

    next_day = client.get(STATUS_URL.format("me"), params={"date": "2026-11-21"}, headers=device)
    assert next_day.status_code == 200
    assert next_day.json()["summary"] == {"total": 1, "done": 0, "pending": 0, "missed": 1, "wrong": 0}
    assert next_day.json()["slots"][0]["status"] == "MISSED"


@pytest.mark.parametrize("value", ["", "20261120", "2026-2-01", "2026-02-30"])
def test_invalid_date_has_specified_error(client, patient_auth, value):
    _, device, _, _ = patient_auth
    res = client.get(STATUS_URL.format("me"), params={"date": value}, headers=device)
    assert res.status_code == 400
    assert res.json() == {
        "code": "INVALID_DATE",
        "message": "조회 날짜가 올바르지 않습니다. 2026-11-20 형식으로 보내 주세요.",
    }


def test_status_requires_the_matching_role_and_ownership(client, patient_auth):
    patient_id, device, guardian, other = patient_auth
    for path_id, headers in [
        ("me", {}),
        ("me", {"X-Device-Token": "wrong"}),
        (patient_id, {"Authorization": "Bearer invalid"}),
    ]:
        res = client.get(STATUS_URL.format(path_id), headers=headers)
        assert res.status_code == 401
        assert res.json() == {"code": "UNAUTHORIZED", "message": "로그인이 필요합니다."}

    for path_id, headers in [("me", guardian), (patient_id, device), (patient_id, other)]:
        res = client.get(STATUS_URL.format(path_id), headers=headers)
        assert res.status_code == 403
        assert res.json() == {"code": "FORBIDDEN", "message": "복약 정보를 조회할 권한이 없습니다."}

    res = client.get(STATUS_URL.format("2147483647"), headers=guardian)
    assert res.status_code == 404
    assert res.json() == {"code": "PATIENT_NOT_FOUND", "message": "복용자 정보를 찾을 수 없습니다."}


def test_empty_status_and_internal_error(client, patient_auth, monkeypatch):
    _, device, _, _ = patient_auth
    url = STATUS_URL.format("me")
    empty = client.get(url, headers=device)
    assert empty.status_code == 200
    assert empty.json()["summary"] == {"total": 0, "done": 0, "pending": 0, "missed": 0, "wrong": 0}
    assert empty.json()["slots"] == []

    def fail(*args):
        raise RuntimeError("database is unavailable")

    monkeypatch.setattr(dose_status, "list_scheduled_doses", fail)
    error = client.get(url, headers=device)
    assert error.status_code == 500
    assert error.json() == {
        "code": "INTERNAL_ERROR",
        "message": "오늘의 복약 정보를 불러오는 중 오류가 발생했습니다.",
    }
