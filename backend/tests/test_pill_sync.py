from datetime import date, datetime
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import AppearanceStatus
from app.main import app
from app.models import DrugInfo, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import pill_appearances
from app.services import pill_sync
from app.services.pill_appearance import ExpectedPill, appearance_from_mfds, compare

AUTH = {"Authorization": "Bearer internal-test"}


def pill(seq, name, *, color="하양", shape="원형", front="A1", back=""):
    return {
        "ITEM_SEQ": seq, "ITEM_NAME": name, "COLOR_CLASS1": color,
        "DRUG_SHAPE": shape, "PRINT_FRONT": front, "PRINT_BACK": back,
    }


@pytest.fixture
def prescription_sync(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "internal_token", "internal-test")
    monkeypatch.setattr(settings, "mfds_service_key", "key%2Btest%3D")
    monkeypatch.setattr(settings, "timezone", "Asia/Seoul")
    monkeypatch.setattr(pill_appearances, "now_local", lambda: datetime(2026, 11, 20, 14))
    cached_seq = str(uuid4().int)[:16]
    with TestClient(app) as client:
        with SessionLocal.begin() as db:
            guardian = Guardian(email=f"{uuid4().hex}@example.com", name="보호자", password_hash="unused")
            patient = Patient(guardian=guardian, name="복용자")
            prescription = Prescription(patient=patient, start_date=date(2026, 11, 20), days=7, ai_json={})
            info = DrugInfo(
                item_seq=cached_seq, item_name="예시약 A", normalized_name="예시약 a",
                dur_json={"source": "keep"}, pill_json=pill(cached_seq, "예시약 A"),
            )
            drugs = [
                PrescriptionDrug(prescription=prescription, drug_name=name, count_per_dose=1, slots=["MORNING"])
                for name in ("예시약 A", "예시약 B", "유사 제품", "동일 제품명")
            ]
            drugs[0].drug_info = info
            db.add_all(drugs)
            db.flush()
            prescription_id = prescription.id
            drug_ids = [drug.id for drug in drugs]
        yield client, prescription_id, drug_ids, cached_seq


def test_sync_reuses_cache_and_links_only_an_exact_unique_product(prescription_sync, monkeypatch):
    client, prescription_id, drug_ids, cached_seq = prescription_sync
    calls = []

    def get(self, url, *, params):
        assert url == pill_sync.MFDS_URL
        assert params["type"] == "json" and params["serviceKey"] == "key+test="
        name = params["item_name"]
        page = params["pageNo"]
        calls.append((name, page))
        if name == "예시약 B":
            records, total = [pill("202600002", name, front="B2", back="02")], 1
        elif name == "유사 제품":
            records, total = [pill("202600003", f"{name} 5mg")], 1
        else:
            records, total = [pill(f"20260001{page}", name)], 2
        return httpx.Response(
            200,
            json={"header": {"resultCode": "00"}, "body": {"items": {"item": records}, "totalCount": total}},
            request=httpx.Request("GET", url, params=params),
        )

    monkeypatch.setattr(pill_sync.httpx.Client, "get", get)
    response = client.post(
        f"/api/v1/prescriptions/{prescription_id}/pill-appearances/sync/", headers=AUTH, json={"refresh": False}
    )
    assert response.status_code == 200
    result = response.json()["data"]
    assert result["sync_status"] == "COMPLETED" and result["source"] == "MFDS_PILL_IDENTIFICATION"
    assert result["synced_at"] == "2026-11-20T14:00:00+09:00"
    assert result["medication_count"] == 4 and result["matched_count"] == 2
    assert [entry["lookup_status"] for entry in result["medications"]] == [
        "MATCHED", "MATCHED", "NOT_FOUND", "AMBIGUOUS",
    ]
    assert result["medications"][1] == {
        "medication_id": drug_ids[1], "medication_name": "예시약 B",
        "color": "흰색", "shape": "원형", "imprint": "B2 / 02", "lookup_status": "MATCHED",
    }
    assert calls == [("예시약 B", 1), ("유사 제품", 1), ("동일 제품명", 1), ("동일 제품명", 2)]
    with SessionLocal() as db:
        drugs = db.scalars(select(PrescriptionDrug).where(
            PrescriptionDrug.prescription_id == prescription_id
        ).order_by(PrescriptionDrug.id)).all()
        assert [drug.item_seq for drug in drugs] == [cached_seq, "202600002", None, None]
        expected = [ExpectedPill(drug.id, appearance_from_mfds(drug.drug_info.pill_json)) for drug in drugs[:2]]
        assert compare(expected, [expected[0].look, expected[1].look], 2).status == AppearanceStatus.COUNT_ONLY


def test_refresh_and_errors_preserve_existing_dur(prescription_sync, monkeypatch):
    client, prescription_id, _, cached_seq = prescription_sync
    url = f"/api/v1/prescriptions/{prescription_id}/pill-appearances/sync/"
    assert client.post(url, json={"refresh": False}).status_code == 401
    assert client.post(url, headers=AUTH, json={}).status_code == 400
    assert client.post(url, headers=AUTH, json={"refresh": "true"}).status_code == 400
    assert client.post("/api/v1/prescriptions/2147483647/pill-appearances/sync/", headers=AUTH, json={
        "refresh": False,
    }).status_code == 404

    def unavailable(client, service_key, field, value, page):
        if field == "item_seq":
            assert value == cached_seq
            return [pill(value, "예시약 A", color="노랑")], 1
        raise pill_sync.MfdsUnavailable("network unavailable")

    monkeypatch.setattr(pill_sync, "_read_page", unavailable)
    response = client.post(url, headers=AUTH, json={"refresh": True})
    assert response.status_code == 503
    assert response.json() == {"success": False, "error": {
        "code": "MFDS_SERVICE_UNAVAILABLE", "message": "의약품 식별 정보를 불러올 수 없습니다.",
    }}
    with SessionLocal() as db:
        assert db.get(DrugInfo, cached_seq).pill_json["COLOR_CLASS1"] == "하양"

    def refresh(client, service_key, field, value, page):
        if field == "item_seq":
            return [pill(value, "예시약 A", color="노랑", shape="타원형")], 1
        return [], 0

    monkeypatch.setattr(pill_sync, "_read_page", refresh)
    response = client.post(url, headers=AUTH, json={"refresh": True})
    assert response.status_code == 200
    assert response.json()["data"]["medications"][0]["color"] == "노란색"
    with SessionLocal() as db:
        info = db.get(DrugInfo, cached_seq)
        assert info.pill_json["DRUG_SHAPE"] == "타원형"
        assert info.dur_json == {"source": "keep"}

    def fail(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(pill_appearances, "sync_pill_appearances", fail)
    response = client.post(url, headers=AUTH, json={"refresh": False})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_SERVER_ERROR"
