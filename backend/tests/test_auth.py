from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def test_full_auth_and_device_lifecycle():
    email = f"guardian-{uuid4().hex}@example.com"
    password = "TestPassword123!"

    with TestClient(app) as client:
        signup = client.post(
            "/api/v1/auth/signup",
            json={
                "user_email": email,
                "password": password,
                "user_nickname": "보호자",
            },
        )
        assert signup.status_code == 201
        assert signup.json()["status"] == "success"

        duplicate = client.post(
            "/api/v1/auth/signup",
            json={
                "user_email": email,
                "password": password,
                "user_nickname": "보호자",
            },
        )
        assert duplicate.status_code == 409

        bad_login = client.post(
            "/api/v1/auth/login",
            json={"user_email": email, "password": "WrongPassword!"},
        )
        assert bad_login.status_code == 401

        login = client.post(
            "/api/v1/auth/login",
            json={"user_email": email, "password": password},
        )
        assert login.status_code == 200
        tokens = login.json()
        guardian_headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        unauthorized_patient = client.post(
            "/api/v1/patients", json={"name": "어머니"}
        )
        assert unauthorized_patient.status_code == 401

        patient = client.post(
            "/api/v1/patients",
            json={"name": "어머니"},
            headers=guardian_headers,
        )
        assert patient.status_code == 201
        patient_id = patient.json()["patient_id"]

        pairing_code = client.post(
            f"/api/v1/patients/{patient_id}/pairing-code",
            headers=guardian_headers,
        )
        assert pairing_code.status_code == 200
        code = pairing_code.json()["pairing_code"]
        assert len(code) == 6

        invalid_pair = client.post("/api/v1/devices/pair", json={"code": "000000"})
        assert invalid_pair.status_code == 400

        pair = client.post("/api/v1/devices/pair", json={"code": code})
        assert pair.status_code == 200
        device_token = pair.json()["device_token"]

        patient_me = client.get(
            "/api/v1/patients/me", headers={"X-Device-Token": device_token}
        )
        assert patient_me.status_code == 200
        assert patient_me.json() == {
            "patient_id": patient_id,
            "name": "어머니",
            "guardian_id": signup.json()["user_id"],
        }

        refreshed = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens["refresh_token"]},
        )
        assert refreshed.status_code == 200
        rotated = refreshed.json()

        reused_refresh = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens["refresh_token"]},
        )
        assert reused_refresh.status_code == 401

        refreshed_headers = {"Authorization": f"Bearer {rotated['access_token']}"}
        logout = client.post(
            "/api/v1/auth/logout",
            json={"refresh_token": rotated["refresh_token"]},
            headers=refreshed_headers,
        )
        assert logout.status_code == 200

        logged_out_access = client.post(
            "/api/v1/patients",
            json={"name": "아버지"},
            headers=refreshed_headers,
        )
        assert logged_out_access.status_code == 401

        logged_out_refresh = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": rotated["refresh_token"]},
        )
        assert logged_out_refresh.status_code == 401

        login_again = client.post(
            "/api/v1/auth/login",
            json={"user_email": email, "password": password},
        )
        assert login_again.status_code == 200
        final_tokens = login_again.json()
        final_headers = {"Authorization": f"Bearer {final_tokens['access_token']}"}

        wrong_delete = client.request(
            "DELETE",
            "/api/v1/auth/user",
            json={"password": "WrongPassword!"},
            headers=final_headers,
        )
        assert wrong_delete.status_code == 401

        deleted = client.request(
            "DELETE",
            "/api/v1/auth/user",
            json={"password": password},
            headers=final_headers,
        )
        assert deleted.status_code == 200

        access_after_delete = client.post(
            "/api/v1/patients",
            json={"name": "아버지"},
            headers=final_headers,
        )
        assert access_after_delete.status_code == 401

        refresh_after_delete = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": final_tokens["refresh_token"]},
        )
        assert refresh_after_delete.status_code == 401

        login_after_delete = client.post(
            "/api/v1/auth/login",
            json={"user_email": email, "password": password},
        )
        assert login_after_delete.status_code == 401

        device_after_delete = client.get(
            "/api/v1/patients/me", headers={"X-Device-Token": device_token}
        )
        assert device_after_delete.status_code == 401
