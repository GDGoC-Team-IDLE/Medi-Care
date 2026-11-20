from datetime import date, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import DoseStatus, MealTiming, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import dose_slots, dose_status
from app.security import create_access_token, token_hash

URL = "/api/v1/patients/{}/dose-slots"
DAY = date(2026, 11, 20)


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


def test_dose_slots_returns_drugs_and_last_log(client, patient_auth, monkeypatch):
    patient_id, device, guardian, _ = patient_auth
    monkeypatch.setattr(get_settings(), "timezone", "Asia/Seoul")
    monkeypatch.setattr(dose_slots, "sign_dose_photos", lambda paths: {p: f"https://photo/{p}" for p in paths})
    with SessionLocal() as db:
        prescription = Prescription(patient_id=patient_id, start_date=DAY, days=3, ai_json={})
        prescription.drugs = [
            PrescriptionDrug(drug_name="타이레놀정500밀리그람", count_per_dose=1, slots=["MORNING"]),
            PrescriptionDrug(
                drug_name="뮤테란캡슐100밀리그램",
                count_per_dose=1,
                slots=["MORNING", "LUNCH"],
                meal_timing=MealTiming.BEFORE,
            ),
        ]
        morning = DoseSlot(
            prescription=prescription,
            patient_id=patient_id,
            slot_date=DAY,
            slot=Slot.MORNING,
            expected_count=2,
            status=DoseStatus.DONE,
        )
        lunch = DoseSlot(
            prescription=prescription,
            patient_id=patient_id,
            slot_date=DAY,
            slot=Slot.LUNCH,
            expected_count=1,
            status=DoseStatus.PENDING,
        )
        log = DoseLog(
            dose_slot=morning,
            photo_path="501.jpg",
            ai_json={},
            result=VerifyResult.OK,
            created_at=datetime(2026, 11, 20, 8, 12),
        )
        db.add_all([morning, lunch, log])
        db.commit()
        ids = (prescription.id, morning.id, lunch.id, log.id)

    me = client.get(URL.format("me"), params={"date": "2026-11-20"}, headers=device)
    owned = client.get(URL.format(patient_id), params={"date": "2026-11-20"}, headers=guardian)
    assert me.status_code == owned.status_code == 200
    assert me.json() == owned.json()

    prescription_id, morning_id, lunch_id, log_id = ids
    assert me.json() == {
        "date": "2026-11-20",
        "slots": [
            {
                "slot_id": morning_id,
                "prescription_id": prescription_id,
                "slot": "MORNING",
                "scheduled_at": "2026-11-20T08:00:00+09:00",
                "expected_count": 2,
                "status": "DONE",
                "drugs": [
                    {"name": "타이레놀정500밀리그람", "count_per_dose": 1, "meal_timing": "AFTER"},
                    {"name": "뮤테란캡슐100밀리그램", "count_per_dose": 1, "meal_timing": "BEFORE"},
                ],
                "last_log": {
                    "dose_log_id": log_id,
                    "result": "OK",
                    "taken_at": "2026-11-20T08:12:00+09:00",
                    "photo_url": "https://photo/501.jpg",
                },
            },
            {
                "slot_id": lunch_id,
                "prescription_id": prescription_id,
                "slot": "LUNCH",
                "scheduled_at": "2026-11-20T12:30:00+09:00",
                "expected_count": 1,
                "status": "PENDING",
                "drugs": [{"name": "뮤테란캡슐100밀리그램", "count_per_dose": 1, "meal_timing": "BEFORE"}],
                "last_log": None,
            },
        ],
        "summary": {"total": 2, "done": 1, "pending": 1, "missed": 0, "wrong": 0},
    }


def test_dose_slots_without_slots_returns_empty_list_for_today(client, patient_auth, monkeypatch):
    _, device, _, _ = patient_auth
    monkeypatch.setattr(dose_status, "now_local", lambda: datetime(2026, 12, 25, 9, 0))

    response = client.get(URL.format("me"), headers=device)

    assert response.status_code == 200
    assert response.json() == {
        "date": "2026-12-25",
        "slots": [],
        "summary": {"total": 0, "done": 0, "pending": 0, "missed": 0, "wrong": 0},
    }


@pytest.mark.parametrize(
    ("path", "headers", "params", "status_code", "code", "message"),
    [
        ("me", "device", {"date": "2026-02-30"}, 400, "INVALID_DATE", "날짜는 2026-11-20 형식으로 보내 주세요."),
        ("me", "device", {"date": "20261120"}, 400, "INVALID_DATE", "날짜는 2026-11-20 형식으로 보내 주세요."),
        ("me", None, {}, 401, "UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
        ("me", "bad_device", {}, 401, "UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
        ("patient", "other", {}, 403, "FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
        ("patient", "device", {}, 403, "FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
        ("999999999", "guardian", {}, 404, "PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    ],
)
def test_dose_slots_errors(client, patient_auth, path, headers, params, status_code, code, message):
    patient_id, device, guardian, other = patient_auth
    header_map = {
        None: {},
        "device": device,
        "bad_device": {"X-Device-Token": "invalid"},
        "guardian": guardian,
        "other": other,
    }

    response = client.get(
        URL.format(patient_id if path == "patient" else path),
        params=params,
        headers=header_map[headers],
    )

    assert response.status_code == status_code
    assert response.json() == {"code": code, "message": message}


def test_dose_slots_unexpected_error_returns_500(client, patient_auth, monkeypatch):
    _, device, _, _ = patient_auth

    def fail(*args):
        raise RuntimeError("db down")

    monkeypatch.setattr(dose_slots, "list_scheduled_doses", fail)

    response = client.get(URL.format("me"), headers=device)

    assert response.status_code == 500
    assert response.json() == {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했어요."}
