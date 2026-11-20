from datetime import datetime
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.main import app
from app.models import DoseSlot, DrugInfo, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import prescriptions, verifications
from app.security import create_access_token, token_hash
from app.services import mfds_catalog

URL = "/api/v1/patients/{}/prescriptions"
DRUG = {
    "name": "예시약 A", "count_per_dose": 1, "slots": ["MORNING", "DINNER"],
    "meal_timing": "AFTER", "days": 3,
}


@pytest.fixture
def registration(monkeypatch):
    monkeypatch.setattr(prescriptions, "now_local", lambda: datetime(2026, 11, 20, 14))
    monkeypatch.setattr(get_settings(), "timezone", "Asia/Seoul")
    monkeypatch.setattr(get_settings(), "mfds_service_key", "")
    device_token = uuid4().hex
    with TestClient(app) as client:
        with SessionLocal.begin() as db:
            owner, outsider = [
                Guardian(email=f"{uuid4().hex}@example.com", name="보호자", password_hash="unused")
                for _ in range(2)
            ]
            patient = Patient(guardian=owner, name="복용자", device_token=token_hash(device_token))
            db.add_all([patient, outsider])
            db.flush()
            patient_id = patient.id
            auth, other = [{"Authorization": f"Bearer {create_access_token(row.id)}"} for row in (owner, outsider)]
        yield client, patient_id, auth, other, {"X-Device-Token": device_token}


def test_saved_prescription_generates_remaining_slots_and_caches_mfds(registration, monkeypatch):
    client, patient_id, auth, _, device = registration
    monkeypatch.setattr(get_settings(), "mfds_service_key", "test%2Bkey")
    pill = {"ITEM_SEQ": "201234567", "ITEM_NAME": "예시약 A", "DRUG_SHAPE": "원형", "COLOR_CLASS1": "하양"}
    warning = {"ITEM_SEQ": "201234567", "MIXTURE_ITEM_SEQ": "201234568", "PROHBT_CONTENT": "예시 병용금기"}
    calls = []

    def respond(request):
        params = request.url.params
        assert params["serviceKey"] == "test+key" and params["type"] == "json"
        calls.append(request.url.path)
        # 첫 외부 요청이 들어왔을 때 DB에는 처방과 회차가 이미 커밋되어 있습니다.
        with SessionLocal() as db:
            saved = db.scalar(select(Prescription).where(Prescription.patient_id == patient_id))
            assert saved is not None and len(saved.dose_slots) == 8
        if request.url.path.endswith("IdntfcInfoList03"):
            rows = [pill] if params["item_name"] == "예시약 A" else []
        elif request.url.path.endswith("getDurPrdlstInfoList03"):
            rows = []
        else:
            assert request.url.path.endswith("getUsjntTabooInfoList03") and params["itemSeq"] == "201234567"
            rows = [warning]
        return httpx.Response(
            200, json={"header": {"resultCode": "00"}, "body": {"items": rows, "totalCount": len(rows)}},
        )

    original_client = httpx.Client
    monkeypatch.setattr(
        mfds_catalog.httpx, "Client",
        lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(respond)),
    )
    response = client.post(URL.format("me"), headers=device, json={"drugs": [
        DRUG,
        {**DRUG, "name": "예시약 B", "count_per_dose": 2, "meal_timing": None, "days": 2,
         "slots": ["MORNING", "LUNCH", "DINNER", "BEDTIME", "BEDTIME"]},
    ]})
    assert response.status_code == 201
    data = response.json()
    assert data["start_date"] == "2026-11-20" and data["end_date"] == "2026-11-22"
    assert data["skipped_today"] == ["MORNING", "LUNCH"]
    assert data["message"] == "복용 일정 8회를 만들었어요. 오늘 아침·점심은 이미 지나서 빼 두었어요."
    assert [row["item_seq"] for row in data["drugs"]] == ["201234567", None]
    assert data["drugs"][1]["meal_timing"] == "AFTER"
    assert [(row["slot_date"], row["slot"], row["expected_count"]) for row in data["slots"]] == [
        ("2026-11-20", "DINNER", 3), ("2026-11-20", "BEDTIME", 2),
        ("2026-11-21", "MORNING", 3), ("2026-11-21", "LUNCH", 2),
        ("2026-11-21", "DINNER", 3), ("2026-11-21", "BEDTIME", 2),
        ("2026-11-22", "MORNING", 1), ("2026-11-22", "DINNER", 1),
    ]
    assert data["slots"][1]["scheduled_at"] == "2026-11-20T21:30:00+09:00"
    assert len(calls) == 5
    with SessionLocal() as db:
        info = db.get(DrugInfo, "201234567")
        assert info.pill_json == pill
        assert info.dur_json == [{**warning, "TYPE_NAME": "병용금기"}]
        slot = db.get(DoseSlot, data["slots"][-1]["slot_id"])
        assert [pill.drug_id for pill in verifications._expected_pills(slot)] == [data["drugs"][0]["drug_id"]]
    fetched = client.get(f"/api/v1/patients/{patient_id}/dose-slots?date=2026-11-22", headers=auth).json()
    assert len(fetched["slots"]) == 2
    assert all([drug["name"] for drug in slot["drugs"]] == ["예시약 A"] for slot in fetched["slots"])


def test_prescription_validation_auth_and_catalog_failure(registration, monkeypatch):
    client, patient_id, auth, other, _ = registration
    url = URL.format(patient_id)
    payload = {"start_date": "2026-11-20", "drugs": [DRUG]}
    for response, status, code in [
        (client.post(url, json=payload), 401, "UNAUTHORIZED"),
        (client.post(url, headers=other, json=payload), 403, "FORBIDDEN"),
        (client.post(URL.format(2147483647), headers=auth, json=payload), 404, "PATIENT_NOT_FOUND"),
        (client.post(url, headers=auth, json={"drugs": [{**DRUG, "slots": []}]}), 400, "VALIDATION_ERROR"),
        (client.post(url, headers=auth, json={"drugs": [{**DRUG, "days": 91}]}), 400, "VALIDATION_ERROR"),
        (client.post(url, headers=auth, json={"drugs": [{**DRUG, "days": 1, "slots": ["MORNING"]}]}),
         400, "NO_SLOTS_CREATED"),
    ]:
        assert response.status_code == status
        assert response.json()["code"] == code
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Prescription).where(Prescription.patient_id == patient_id)) == 0

    def fail(*args):
        raise RuntimeError("MFDS unavailable")

    monkeypatch.setattr(prescriptions, "cache_prescription_drugs", fail)
    response = client.post(url, headers=auth, json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["drugs"][0]["item_seq"] is None
    with SessionLocal() as db:
        assert db.get(PrescriptionDrug, data["drugs"][0]["drug_id"]).days == 3
        assert db.get(Prescription, data["prescription_id"]).days == 3
