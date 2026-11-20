from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.database import SessionLocal
from app.main import app
from app.models import PairAttempt

PASSWORD = "TestPassword123!"


def _guardian(client: TestClient) -> dict[str, str]:
    email = f"patients-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={"user_email": email, "password": PASSWORD, "user_nickname": "보호자"},
    )
    assert signup.status_code == 201
    login = client.post("/api/v1/auth/login", json={"user_email": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _patient(client: TestClient, headers: dict[str, str], name: str) -> int:
    res = client.post("/api/v1/patients", json={"name": name}, headers=headers)
    assert res.status_code == 201
    return res.json()["patient_id"]


def _pair(client: TestClient, headers: dict[str, str], patient_id: int) -> str:
    code = client.post(f"/api/v1/patients/{patient_id}/pairing-code", headers=headers).json()["pairing_code"]
    # 다른 테스트의 IP별 연결 시도 횟수가 이 테스트에 영향을 주지 않게 격리합니다.
    with SessionLocal() as db:
        db.execute(delete(PairAttempt))
        db.commit()
    paired = client.post("/api/v1/devices/pair", json={"code": code})
    assert paired.status_code == 200
    return paired.json()["device_token"]


def test_list_patients_shows_only_my_patients_in_created_order():
    with TestClient(app) as client:
        me = _guardian(client)
        other = _guardian(client)
        assert client.get("/api/v1/patients", headers=me).json() == {"patients": []}

        mother = _patient(client, me, "어머니")
        father = _patient(client, me, "아버지")
        _patient(client, other, "다른 보호자의 어르신")

        res = client.get("/api/v1/patients", headers=me)
        assert res.status_code == 200
        assert res.json() == {
            "patients": [
                {"patient_id": mother, "name": "어머니", "paired": False},
                {"patient_id": father, "name": "아버지", "paired": False},
            ]
        }


def test_list_patients_marks_paired_after_device_pairing():
    with TestClient(app) as client:
        me = _guardian(client)
        patient_id = _patient(client, me, "어머니")
        _pair(client, me, patient_id)

        res = client.get("/api/v1/patients", headers=me)
        assert res.json() == {"patients": [{"patient_id": patient_id, "name": "어머니", "paired": True}]}


def test_list_patients_requires_guardian_token():
    with TestClient(app) as client:
        assert client.get("/api/v1/patients").status_code == 401
        assert client.get("/api/v1/patients", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401

        # 어르신 기기 토큰으로는 보호자의 목록을 볼 수 없습니다.
        me = _guardian(client)
        device_token = _pair(client, me, _patient(client, me, "어머니"))
        assert client.get("/api/v1/patients", headers={"X-Device-Token": device_token}).status_code == 401
