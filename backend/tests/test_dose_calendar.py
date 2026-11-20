from datetime import date, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.enums import DoseStatus, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, Guardian, Patient, Prescription
from app.routers import dose_calendar
from app.security import create_access_token, token_hash

CALENDAR_URL = "/api/v1/patients/{}/calendar"
SLOTS = list(Slot)


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def patient_auth(client, monkeypatch):
    monkeypatch.setattr(dose_calendar, "now_local", lambda: datetime(2026, 11, 20, 9, 0))
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


def _add_day(db, prescription, slot_date, plan):
    # plan: (DB 상태, 인증 결과 또는 None) 을 회차 순서대로
    for slot, (status, result) in zip(SLOTS, plan):
        dose_slot = DoseSlot(
            prescription=prescription,
            patient_id=prescription.patient_id,
            slot_date=slot_date,
            slot=slot,
            expected_count=1,
            status=status,
        )
        db.add(dose_slot)
        if result is not None:
            db.add(DoseLog(
                dose_slot=dose_slot,
                photo_path=f"{uuid4().hex}.jpg",
                ai_json={},
                result=result,
                created_at=datetime.combine(slot_date, datetime.min.time()),
            ))


def test_calendar_counts_each_day_like_the_spec_example(client, patient_auth):
    patient_id, device, guardian, _ = patient_auth
    done = (DoseStatus.DONE, VerifyResult.OK)
    with SessionLocal() as db:
        prescription = Prescription(patient_id=patient_id, start_date=date(2026, 10, 31), days=40, ai_json={})
        _add_day(db, prescription, date(2026, 10, 31), [done])
        _add_day(db, prescription, date(2026, 11, 17), [
            (DoseStatus.WRONG, VerifyResult.COUNT_MISMATCH),
            (DoseStatus.MISSED, None),
        ])
        # DB 상태가 아직 PENDING 이어도 OK 인증이 있으면 복용 완료로 셉니다.
        _add_day(db, prescription, date(2026, 11, 18), [done, done, (DoseStatus.PENDING, VerifyResult.OK)])
        _add_day(db, prescription, date(2026, 11, 19), [done, done, (DoseStatus.MISSED, None)])
        _add_day(db, prescription, date(2026, 11, 20), [done] + [(DoseStatus.PENDING, None)] * 3)
        _add_day(db, prescription, date(2026, 12, 1), [done])
        db.commit()

    me = client.get(CALENDAR_URL.format("me"), params={"month": "2026-11"}, headers=device)
    owned = client.get(CALENDAR_URL.format(patient_id), headers=guardian)
    assert me.status_code == owned.status_code == 200
    assert me.headers["cache-control"] == "no-store"
    assert me.json() == owned.json() == {
        "month": "2026-11",
        "days": [
            {"date": "2026-11-17", "total": 2, "done": 0, "missed": 1, "wrong": 1, "pending": 0, "photo_count": 1, "day_status": "NONE_DONE"},
            {"date": "2026-11-18", "total": 3, "done": 3, "missed": 0, "wrong": 0, "pending": 0, "photo_count": 3, "day_status": "ALL_DONE"},
            {"date": "2026-11-19", "total": 3, "done": 2, "missed": 1, "wrong": 0, "pending": 0, "photo_count": 2, "day_status": "PARTIAL"},
            {"date": "2026-11-20", "total": 4, "done": 1, "missed": 0, "wrong": 0, "pending": 3, "photo_count": 1, "day_status": "UPCOMING"},
        ],
        "summary": {"total": 12, "done": 6, "missed": 2, "wrong": 1, "pending": 3, "adherence_rate": 66.7},
    }

    empty = client.get(CALENDAR_URL.format("me"), params={"month": "2026-09"}, headers=device)
    assert empty.status_code == 200
    assert empty.json() == {
        "month": "2026-09",
        "days": [],
        "summary": {"total": 0, "done": 0, "missed": 0, "wrong": 0, "pending": 0, "adherence_rate": 0.0},
    }


def test_today_without_pending_uses_the_past_day_rule(client, patient_auth):
    _, device, _, _ = patient_auth
    with SessionLocal() as db:
        prescription = Prescription(patient_id=patient_auth[0], start_date=date(2026, 11, 20), days=2, ai_json={})
        _add_day(db, prescription, date(2026, 11, 20), [(DoseStatus.DONE, VerifyResult.OK), (DoseStatus.MISSED, None)])
        _add_day(db, prescription, date(2026, 11, 21), [(DoseStatus.DONE, VerifyResult.OK)])
        db.commit()

    days = client.get(CALENDAR_URL.format("me"), headers=device).json()["days"]
    assert [(day["date"], day["day_status"]) for day in days] == [
        ("2026-11-20", "PARTIAL"),
        ("2026-11-21", "UPCOMING"),
    ]


@pytest.mark.parametrize("value", ["", "202611", "2026-1", "2026-13", "0000-01", "2026-11-01"])
def test_invalid_month_has_specified_error(client, patient_auth, value):
    _, device, _, _ = patient_auth
    res = client.get(CALENDAR_URL.format("me"), params={"month": value}, headers=device)
    assert res.status_code == 400
    assert res.json() == {"code": "INVALID_MONTH", "message": "달은 2026-11 형식으로 보내 주세요."}


def test_calendar_requires_the_matching_role_and_ownership(client, patient_auth):
    patient_id, device, guardian, other = patient_auth
    for path_id, headers in [("me", {}), ("me", {"X-Device-Token": "wrong"}), (patient_id, {"Authorization": "Bearer invalid"})]:
        res = client.get(CALENDAR_URL.format(path_id), headers=headers)
        assert res.status_code == 401
        assert res.json() == {"code": "UNAUTHORIZED", "message": "로그인 정보가 없어요. 다시 로그인해 주세요."}

    for path_id, headers in [("me", guardian), (patient_id, device), (patient_id, other)]:
        res = client.get(CALENDAR_URL.format(path_id), headers=headers)
        assert res.status_code == 403
        assert res.json() == {"code": "FORBIDDEN", "message": "이 어르신의 정보에 접근할 수 없어요."}

    res = client.get(CALENDAR_URL.format("2147483647"), headers=guardian)
    assert res.status_code == 404
    assert res.json() == {"code": "PATIENT_NOT_FOUND", "message": "어르신 정보를 찾을 수 없어요."}


def test_calendar_internal_error(client, patient_auth, monkeypatch):
    _, device, _, _ = patient_auth

    def fail():
        raise RuntimeError("clock is unavailable")

    monkeypatch.setattr(dose_calendar, "now_local", fail)
    res = client.get(CALENDAR_URL.format("me"), headers=device)
    assert res.status_code == 500
    assert res.json() == {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했어요."}
