from datetime import date, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.enums import DoseStatus, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, DrugInfo, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import prescription_list
from app.security import create_access_token, token_hash

URL = "/api/v1/patients/{}/prescriptions"


def test_prescription_list_progress_durations_and_access(monkeypatch):
    monkeypatch.setattr(prescription_list, "now_local", lambda: datetime(2026, 11, 20, 14))
    device = uuid4().hex
    with TestClient(app) as client:
        with SessionLocal.begin() as db:
            owner, stranger = [
                Guardian(email=f"{uuid4().hex}@example.com", name="보호자", password_hash="unused")
                for _ in range(2)
            ]
            patient = Patient(guardian=owner, name="복용자", device_token=token_hash(device))
            empty_patient = Patient(guardian=owner, name="처방 없는 복용자")
            expired = Prescription(patient=patient, start_date=date(2026, 11, 17), days=3, ai_json={})
            current = Prescription(patient=patient, start_date=date(2026, 11, 18), days=3, ai_json={})
            future = Prescription(patient=patient, start_date=date(2026, 11, 22), days=3, ai_json={})
            info = DrugInfo(
                item_seq="201900123", item_name="예시약 A", normalized_name="예시약 a",
                dur_json={}, pill_json={},
            )
            short = PrescriptionDrug(
                prescription=current, drug_info=info, drug_name="예시약 A", days=2,
                count_per_dose=1, slots=["MORNING", "DINNER"],
            )
            legacy = PrescriptionDrug(
                prescription=current, drug_name="예시약 B", count_per_dose=2,
                slots=["LUNCH"],
            )
            db.add_all([expired, future, empty_patient, stranger, short, legacy])
            db.flush()
            slots = [
                DoseSlot(
                    prescription=current, patient_id=patient.id, slot_date=date(2026, 11, 19),
                    slot=slot, status=status, expected_count=1,
                )
                for slot, status in [
                    (Slot.MORNING, DoseStatus.DONE), (Slot.LUNCH, DoseStatus.PENDING),
                    (Slot.DINNER, DoseStatus.WRONG), (Slot.BEDTIME, DoseStatus.MISSED),
                ]
            ]
            db.add_all(slots)
            db.add_all([
                DoseLog(dose_slot=slots[1], result=VerifyResult.OK, ai_json={}, photo_path="ok.jpg"),
                DoseLog(dose_slot=slots[1], result=VerifyResult.OK, ai_json={}, photo_path="another.jpg"),
                DoseLog(dose_slot=slots[2], result=VerifyResult.COUNT_MISMATCH, ai_json={}, photo_path="wrong.jpg"),
            ])
            auth, outsider = [
                {"Authorization": f"Bearer {create_access_token(guardian.id)}"} for guardian in (owner, stranger)
            ]
            patient_id, empty_id = patient.id, empty_patient.id
            expired_id, current_id, future_id = expired.id, current.id, future.id
            short_id, legacy_id = short.id, legacy.id

        url = URL.format(patient_id)
        response = client.get(URL.format("me"), headers={"X-Device-Token": device})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        listed = response.json()["prescriptions"]
        assert [rx["prescription_id"] for rx in listed] == [future_id, current_id]
        assert listed[0]["is_active"] is True
        assert listed[0]["progress"] == {"done": 0, "total": 0}
        assert listed[1] == {
            "prescription_id": current_id,
            "start_date": "2026-11-18",
            "end_date": "2026-11-20",
            "is_active": True,
            "progress": {"done": 2, "total": 4},
            "drugs": [
                {
                    "id": short_id, "name": "예시약 A", "item_seq": "201900123",
                    "count_per_dose": 1, "slots": ["MORNING", "DINNER"], "meal_timing": "AFTER", "days": 2,
                },
                {
                    "id": legacy_id, "name": "예시약 B", "item_seq": None,
                    "count_per_dose": 2, "slots": ["LUNCH"], "meal_timing": "AFTER", "days": 3,
                },
            ],
        }
        response = client.get(url, headers=auth, params={"active": "false"})
        assert response.status_code == 200
        all_items = response.json()["prescriptions"]
        assert all_items[:2] == listed
        assert all_items[-1]["prescription_id"] == expired_id and all_items[-1]["is_active"] is False
        assert client.get(URL.format(empty_id), headers=auth).json() == {"prescriptions": []}

        for response, status, code, message in [
            (client.get(url), 401, "UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
            (client.get(url, headers=outsider), 403, "FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
            (client.get(URL.format(2147483647), headers=auth), 404, "PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
        ]:
            assert response.status_code == status
            assert response.json() == {"code": code, "message": message}

        def fail(*args):
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(prescription_list, "_list_prescriptions", fail)
        response = client.get(url, headers=auth)
        assert response.status_code == 500
        assert response.json() == {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했어요."}
