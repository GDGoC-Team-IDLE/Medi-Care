from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def _signup_login_and_create_patient(client: TestClient, email: str):
    password = "TestPassword123!"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "user_email": email,
            "password": password,
            "user_nickname": "보호자",
        },
    )
    assert signup.status_code == 201

    login = client.post(
        "/api/v1/auth/login",
        json={"user_email": email, "password": password},
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    patient = client.post(
        "/api/v1/patients",
        json={"name": "어머니"},
        headers=headers,
    )
    assert patient.status_code == 201
    return patient.json()["patient_id"], headers


def test_guardian_updates_and_device_reads_alarm_settings():
    with TestClient(app) as client:
        patient_id, guardian_headers = _signup_login_and_create_patient(
            client, f"alarm-{uuid4().hex}@example.com"
        )

        default_settings = client.get(
            f"/api/v1/patients/{patient_id}/alarm-settings",
            headers=guardian_headers,
        )
        assert default_settings.status_code == 200
        assert default_settings.json() == {
            "patient_id": patient_id,
            "settings": [
                {"slot": "MORNING", "mode": "POPUP"},
                {"slot": "LUNCH", "mode": "POPUP"},
                {"slot": "DINNER", "mode": "POPUP"},
                {"slot": "BEDTIME", "mode": "POPUP"},
            ],
        }

        updated = client.patch(
            f"/api/v1/patients/{patient_id}/alarm-settings",
            headers=guardian_headers,
            json={
                "settings": [
                    {"slot": "LUNCH", "mode": "FULLSCREEN"},
                    {"slot": "DINNER", "mode": "FULLSCREEN"},
                ]
            },
        )
        assert updated.status_code == 200
        assert updated.json()["settings"] == [
            {"slot": "MORNING", "mode": "POPUP"},
            {"slot": "LUNCH", "mode": "FULLSCREEN"},
            {"slot": "DINNER", "mode": "FULLSCREEN"},
            {"slot": "BEDTIME", "mode": "POPUP"},
        ]

        pairing_code = client.post(
            f"/api/v1/patients/{patient_id}/pairing-code",
            headers=guardian_headers,
        )
        assert pairing_code.status_code == 200
        paired = client.post(
            "/api/v1/devices/pair",
            json={"code": pairing_code.json()["pairing_code"]},
        )
        assert paired.status_code == 200

        device_settings = client.get(
            "/api/v1/patients/me/alarm-settings",
            headers={"X-Device-Token": paired.json()["device_token"]},
        )
        assert device_settings.status_code == 200
        assert device_settings.json() == updated.json()


def test_alarm_settings_reject_unauthorized_and_duplicate_slots():
    with TestClient(app) as client:
        patient_id, owner_headers = _signup_login_and_create_patient(
            client, f"alarm-owner-{uuid4().hex}@example.com"
        )
        _, other_headers = _signup_login_and_create_patient(
            client, f"alarm-other-{uuid4().hex}@example.com"
        )

        unauthorized = client.get(f"/api/v1/patients/{patient_id}/alarm-settings")
        assert unauthorized.status_code == 401

        forbidden = client.patch(
            f"/api/v1/patients/{patient_id}/alarm-settings",
            headers=other_headers,
            json={"settings": [{"slot": "MORNING", "mode": "FULLSCREEN"}]},
        )
        assert forbidden.status_code == 403

        duplicate = client.patch(
            f"/api/v1/patients/{patient_id}/alarm-settings",
            headers=owner_headers,
            json={
                "settings": [
                    {"slot": "MORNING", "mode": "POPUP"},
                    {"slot": "MORNING", "mode": "FULLSCREEN"},
                ]
            },
        )
        assert duplicate.status_code == 400
