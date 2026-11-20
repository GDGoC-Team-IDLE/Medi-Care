from datetime import date, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import DoseStatus, Slot, VerifyResult
from app.main import app
from app.models import DoseLog, DoseSlot, Guardian, Patient, Prescription
from app.routers import guardian_doses
from app.security import create_access_token


def test_guardian_today_doses_contract_and_ownership(monkeypatch):
    today = date(2026, 11, 20)
    monkeypatch.setattr(guardian_doses, "now_local", lambda: datetime(2026, 11, 20, 12))
    monkeypatch.setattr(get_settings(), "timezone", "Asia/Seoul")
    sign_calls = []

    def sign(paths):
        paths = list(paths)
        sign_calls.append(paths)
        return {path: f"https://storage.example.com/{path}?token=signed" for path in paths}

    monkeypatch.setattr(guardian_doses, "sign_dose_photos", sign)
    with TestClient(app) as client, SessionLocal() as db:
        owner, stranger = [
            Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="보호자")
            for _ in range(2)
        ]
        patient = Patient(name="복용자", guardian=owner)
        prescription = Prescription(patient=patient, start_date=today, days=2, ai_json={})
        db.add_all([prescription, stranger])
        db.flush()
        rounds = {}
        for day, slot, status in [
            (today, Slot.DINNER, DoseStatus.MISSED),
            (today, Slot.BEDTIME, DoseStatus.PENDING),
            (today, Slot.MORNING, DoseStatus.DONE),
            (today, Slot.LUNCH, DoseStatus.WRONG),
            (date(2026, 11, 21), Slot.MORNING, DoseStatus.PENDING),
        ]:
            dose = DoseSlot(
                patient_id=patient.id, prescription=prescription, slot_date=day,
                slot=slot, status=status, expected_count=1,
            )
            db.add(dose)
            if day == today:
                rounds[slot] = dose
        for slot, result, path, hour, minute in [
            (Slot.MORNING, VerifyResult.OK, "morning.jpg", 8, 5),
            (Slot.MORNING, VerifyResult.ALREADY_TAKEN, "duplicate.jpg", 8, 25),
            (Slot.LUNCH, VerifyResult.COUNT_MISMATCH, "lunch.jpg", 12, 10),
        ]:
            db.add(DoseLog(
                dose_slot=rounds[slot], result=result, photo_path=path, ai_json={},
                created_at=datetime(2026, 11, 20, hour, minute),
            ))
        db.commit()

        url = f"/api/v1/guardian/patients/{patient.id}/doses/today/"
        auth = {"Authorization": f"Bearer {create_access_token(owner.id)}"}
        outsider = {"Authorization": f"Bearer {create_access_token(stranger.id)}"}
        for result, status, code in [
            (client.get(url), 401, "UNAUTHORIZED"),
            (client.get(url, headers=outsider), 403, "FORBIDDEN"),
            (client.get(
                "/api/v1/guardian/patients/2147483647/doses/today/", headers=auth
            ), 404, "PATIENT_NOT_FOUND"),
        ]:
            assert result.status_code == status
            assert result.json()["success"] is False
            assert result.json()["error"]["code"] == code
        assert sign_calls == []

        result = client.get(url, headers=auth)
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        payload = result.json()
        assert payload["success"] is True
        assert payload["data"]["patient_id"] == patient.id
        assert payload["data"]["date"] == "2026-11-20"
        morning, lunch, dinner, bedtime = payload["data"]["rounds"]
        assert morning == {
            "round_id": rounds[Slot.MORNING].id,
            "round_name": "아침",
            "scheduled_at": "08:00",
            "status": "COMPLETED",
            "verified_at": "2026-11-20T08:05:00+09:00",
            "photo_url": "https://storage.example.com/morning.jpg?token=signed",
        }
        assert lunch["status"] == "INCORRECT"
        assert lunch["verified_at"] == "2026-11-20T12:10:00+09:00"
        assert dinner["status"] == "MISSED"
        assert dinner["verified_at"] is dinner["photo_url"] is None
        assert bedtime["status"] == "SCHEDULED"
        assert sign_calls == [["morning.jpg", "lunch.jpg"]]

        def fail(_):
            raise RuntimeError("storage is unavailable")

        monkeypatch.setattr(guardian_doses, "sign_dose_photos", fail)
        result = client.get(url, headers=auth)
        assert result.status_code == 500
        assert result.json()["error"]["code"] == "INTERNAL_SERVER_ERROR"
