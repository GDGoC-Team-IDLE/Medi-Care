import json
from datetime import date, datetime
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core import report_summary
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import DoseStatus, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, DrugInfo, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import reports
from app.security import create_access_token


def test_report_filters_records_and_protects_patient_access(monkeypatch):
    monkeypatch.setattr(reports, "now_local", lambda: datetime(2026, 11, 20, 12))
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    requests = []

    def generate(request, timeout):
        requests.append(json.loads(request.data))
        return BytesIO(json.dumps({"candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": "복약 인증 기록을 요약했어요."}]},
        }]}).encode())

    monkeypatch.setattr(report_summary, "urlopen", generate)
    with TestClient(app) as client, SessionLocal() as db:
        guardian, other = [
            Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="보호자")
            for _ in range(2)
        ]
        patient = Patient(guardian=guardian, name="김순자")
        active = Prescription(patient=patient, start_date=date(2026, 11, 5), days=21, ai_json={})
        expired = Prescription(patient=patient, start_date=date(2026, 10, 25), days=10, ai_json={})
        db.add_all([active, expired, other])
        db.flush()

        def add_drug(code, name, prescription, related_codes):
            info = DrugInfo(
                item_seq=code, item_name=name, normalized_name=name, pill_json={},
                dur_json={"body": {"items": [
                    {
                        "TYPE_NAME": "병용금기",
                        "ITEM_SEQ": code,
                        "MIXTURE_ITEM_SEQ": related,
                        "PROHBT_CONTENT": "병용금기 대상 성분 조합",
                    }
                    for related in related_codes
                ]}},
            )
            db.add(PrescriptionDrug(
                prescription=prescription, drug_name=name, drug_info=info,
                count_per_dose=1, slots=["MORNING"],
            ))

        add_drug("001", "예시약 A", active, ["002", "003"])
        add_drug("002", "예시약 B", active, ["001"])
        add_drug("003", "만료된 약", expired, ["001"])
        for prescription, day, slot, status in [
            (active, 7, Slot.MORNING, DoseStatus.DONE),
            (active, 15, Slot.LUNCH, DoseStatus.DONE),
            (active, 20, Slot.LUNCH, DoseStatus.MISSED),
            (active, 20, Slot.DINNER, DoseStatus.PENDING),
            (expired, 1, Slot.LUNCH, DoseStatus.MISSED),
        ]:
            dose = DoseSlot(
                prescription=prescription, patient_id=patient.id, slot_date=date(2026, 11, day),
                slot=slot, expected_count=1, status=status,
            )
            db.add(dose)
            if day == 15:
                for minute, result in [(1, VerifyResult.COUNT_MISMATCH), (2, VerifyResult.RETAKE)]:
                    db.add(DoseLog(
                        dose_slot=dose, result=result, photo_path="private.jpg", ai_json={},
                        created_at=datetime(2026, 11, day, 12, minute),
                    ))
        db.commit()
        url = f"/api/v1/patients/{patient.id}/report"
        owner = {"Authorization": f"Bearer {create_access_token(guardian.id)}"}
        outsider = {"Authorization": f"Bearer {create_access_token(other.id)}"}

        for response, status, code in [
            (client.get(url), 401, "UNAUTHORIZED"),
            (client.get(url, headers=outsider), 403, "FORBIDDEN"),
            (client.get("/api/v1/patients/2147483647/report", headers=owner), 404, "PATIENT_NOT_FOUND"),
            (client.get(url, params={"days": "abc"}, headers=owner), 400, "INVALID_DAYS"),
            (client.get(url, params={"days": 15}, headers=owner), 400, "INVALID_DAYS"),
        ]:
            assert response.status_code == status
            assert response.json()["code"] == code
        assert requests == []

        response = client.get(url, headers=owner)
        assert response.status_code == 200
        body = response.json()
        assert (body["days"], body["start_date"], body["end_date"]) == (14, "2026-11-07", "2026-11-20")
        assert [med["name"] for med in body["medications"]] == ["예시약 A", "예시약 B"]
        assert body["medications"][0]["end_date"] == "2026-11-25"
        assert body["adherence"] == {
            "total": 3, "done": 2, "missed": 1, "wrong": 0, "adherence_rate": 66.67,
            "by_slot": [
                {"slot": "MORNING", "total": 1, "done": 1, "rate": 100.0},
                {"slot": "LUNCH", "total": 2, "done": 1, "rate": 50.0},
            ],
        }
        assert body["missed_summary"] == {"most_missed_slot": "LUNCH", "missed_count": 1}
        assert body["wrong_records"] == [{
            "date": "2026-11-15", "slot": "LUNCH", "result": "COUNT_MISMATCH",
            "message": "알약 개수가 등록된 개수와 달랐어요.",
        }]
        assert len(body["dur_warnings"]) == 1
        warning = body["dur_warnings"][0]
        assert warning["type"] == "CONCOMITANT_CONTRAINDICATION"
        assert sorted(warning["drugs"]) == ["예시약 A", "예시약 B"]
        assert warning["source"] == "MFDS_DUR"
        assert body["ai_summary"] == "복약 인증 기록을 요약했어요."
        sent = json.loads(requests[0]["contents"][0]["parts"][0]["text"])
        assert set(sent) == {"days", "adherence", "missed_summary", "verification_result_counts"}
        assert sent["verification_result_counts"] == {"COUNT_MISMATCH": 1}

        month = client.get(url, params={"days": 30}, headers=owner).json()
        assert month["start_date"] == "2026-10-22"
        assert month["adherence"]["missed"] == 2
