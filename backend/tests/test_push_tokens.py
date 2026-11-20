from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.main import app
from app.models import Guardian, PushToken
from app.security import create_access_token

URL = "/api/v1/push-tokens"


@pytest.fixture
def registration():
    with TestClient(app) as client:
        with SessionLocal.begin() as db:
            guardians = [
                Guardian(email=f"{uuid4().hex}@example.com", name="보호자", password_hash="unused")
                for _ in range(2)
            ]
            db.add_all(guardians)
            db.flush()
            guardian_ids = [guardian.id for guardian in guardians]
        headers = [
            {"Authorization": f"Bearer {create_access_token(guardian_id)}"} for guardian_id in guardian_ids
        ]
        yield client, guardian_ids, headers


def test_same_push_token_keeps_id_and_moves_only_that_device(registration):
    client, (first, second), (first_auth, second_auth) = registration
    shared = f"ExponentPushToken[{uuid4().hex}]"
    other = f"ExponentPushToken[{uuid4().hex}]"
    body = {"expo_token": shared}

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(client.post, URL, headers=auth, json=body) for auth in (first_auth, second_auth)]
        first_result, second_result = [request.result() for request in requests]
    assert first_result.status_code == second_result.status_code == 200
    assert first_result.json() == second_result.json()
    token_id = first_result.json()["push_token_id"]
    assert first_result.json() == {
        "push_token_id": token_id,
        "expo_token": shared,
        "message": "알림 받을 준비가 됐어요.",
    }

    assert client.post(URL, headers=first_auth, json=body).json()["push_token_id"] == token_id
    assert client.post(URL, headers=first_auth, json={"expo_token": other}).status_code == 200
    with SessionLocal() as db:
        assert set(db.scalars(select(PushToken.expo_token).where(PushToken.guardian_id == first))) == {shared, other}
    assert client.post(URL, headers=second_auth, json=body).json()["push_token_id"] == token_id
    with SessionLocal() as db:
        rows = db.scalars(select(PushToken).where(PushToken.expo_token.in_([shared, other]))).all()
        assert {row.expo_token: row.guardian_id for row in rows} == {shared: second, other: first}


def test_push_token_errors_match_the_api_contract(registration, monkeypatch):
    client, _, (auth, _) = registration
    invalid = {"code": "INVALID_PUSH_TOKEN", "message": "알림 토큰 형식이 올바르지 않아요."}
    for body in ({}, {"expo_token": None}, {"expo_token": "ExpoPushToken[test]"}, {"expo_token": "ExponentPushToken[]"}):
        result = client.post(URL, headers=auth, json=body)
        assert result.status_code == 400
        assert result.json() == invalid
    result = client.post(URL, headers={**auth, "Content-Type": "application/json"}, content="{")
    assert result.status_code == 400
    assert result.json() == invalid

    body = {"expo_token": f"ExponentPushToken[{uuid4().hex}]"}
    for headers in ({"X-Device-Token": "only-device"}, {"Authorization": "Bearer invalid"}):
        result = client.post(URL, headers=headers, json=body)
        assert result.status_code == 401
        assert result.json() == {"code": "UNAUTHORIZED", "message": "로그인 정보가 없어요. 다시 로그인해 주세요."}

    def fail_commit(self):
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(Session, "commit", fail_commit)
    result = client.post(URL, headers=auth, json=body)
    assert result.status_code == 500
    assert result.json() == {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했어요."}
    with SessionLocal() as db:
        assert db.scalar(select(PushToken.id).where(PushToken.expo_token == body["expo_token"])) is None
