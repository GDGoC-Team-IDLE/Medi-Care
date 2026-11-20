from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.core.database import engine
from app.main import app

EXPECTED_TABLES = {
    "guardians",
    "patients",
    "alarm_settings",
    "push_tokens",
    "guardian_notifications",
    "drug_info",
    "prescriptions",
    "prescription_drugs",
    "dose_slots",
    "dose_logs",
    "refresh_tokens",
    "revoked_access_tokens",
    "pairing_codes",
    "pair_attempts",
    "guardian_alerts",
    "dur_checks",
}


def test_app_starts_and_health_ok():
    with TestClient(app) as client:
        res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok"}


def test_cors_allows_expo_web_dev_server():
    with TestClient(app) as client:
        res = client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:8081",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,x-device-token",
            },
        )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:8081"


def test_create_all_makes_every_table():
    with TestClient(app):  # lifespan 에서 create_all 실행
        tables = set(inspect(engine).get_table_names())
    assert tables == EXPECTED_TABLES
