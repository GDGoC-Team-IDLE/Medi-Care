from collections.abc import Iterator
from datetime import datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.clock import demo_offset, now_local, set_demo_offset
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import Slot
from app.main import app
from app.models import PairAttempt
from app.routers.demo import load_demo_clock
from app.routers.verifications import get_photo_analyzer
from app.services.dose_photo import DetectedPill, PhotoAnalysis

V = "/api/v1"


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def demo(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> Iterator[None]:
    monkeypatch.setattr(get_settings(), "demo_any_day", True)
    yield
    # 시계는 서버 전체에 하나라 다른 테스트에 남지 않게 되돌린다 (DB 에도)
    client.post(f"{V}/patients/me/demo/reset", headers={})
    set_demo_offset(0)
    with SessionLocal() as db:
        from app.models import DemoClock

        db.execute(delete(DemoClock))
        db.commit()


def _elder(client: TestClient) -> tuple[dict[str, str], dict[str, str]]:
    email = f"demo-{uuid4().hex}@example.com"
    client.post(f"{V}/auth/signup", json={"user_email": email, "password": "password123", "user_nickname": "딸"})
    g = {"Authorization": f"Bearer {client.post(f'{V}/auth/login', json={'user_email': email, 'password': 'password123'}).json()['access_token']}"}
    pid = client.post(f"{V}/patients", json={"name": "어머니"}, headers=g).json()["patient_id"]
    code = client.post(f"{V}/patients/{pid}/pairing-code", headers=g).json()["pairing_code"]
    with SessionLocal() as db:  # 다른 테스트의 IP별 연결 시도 횟수와 격리
        db.execute(delete(PairAttempt))
        db.commit()
    dev = {"X-Device-Token": client.post(f"{V}/devices/pair", json={"code": code}).json()["device_token"]}
    drugs = [{"name": "가", "count_per_dose": 1, "slots": ["MORNING", "DINNER"], "meal_timing": "AFTER", "days": 3}]
    assert client.post(f"{V}/patients/me/prescriptions", json={"drugs": drugs}, headers=dev).status_code == 201
    return dev, g


def _verify(client: TestClient, dev: dict[str, str], slot_id: int, slot: str):
    app.dependency_overrides[get_photo_analyzer] = lambda: (lambda image, mime: PhotoAnalysis(Slot(slot), (DetectedPill(None, False),), "NONE", {}))
    return client.post(f"{V}/patients/me/dose-slots/{slot_id}/verifications", files={"image": ("d.jpg", b"\xff\xd8\xff" + b"0" * 40, "image/jpeg")}, headers=dev)


def test_demo_next_moves_server_clock_to_next_dose_and_back(client: TestClient, demo: None):
    dev, g = _elder(client)

    first = client.post(f"{V}/patients/me/demo/next", headers=dev)
    assert first.status_code == 200, first.text
    moved = first.json()
    # 서버의 '지금'이 그 회차 시각이 되고, 오늘 회차 · 보호자 현황이 그날을 본다
    now = client.get(f"{V}/demo/now").json()
    assert now["demo"] is True and now["now"] == moved["now"]
    assert now["now"].startswith(moved["date"])
    assert client.get(f"{V}/patients/me/dose-slots", headers=dev).json()["date"] == moved["date"]

    # 옮긴 회차는 '오늘' 회차라 바로 인증된다
    assert _verify(client, dev, moved["slot_id"], moved["slot"]).json()["result"] == "OK"

    # 다음으로 다시 옮기면 그다음 예정 회차 (방금 인증한 회차보다 늦음)
    second = client.post(f"{V}/patients/me/demo/next", headers=dev).json()
    assert datetime.fromisoformat(second["now"]) > datetime.fromisoformat(moved["now"])

    # 서버를 다시 켜도 시계가 이어진다
    offset = demo_offset()
    set_demo_offset(0)
    load_demo_clock()
    assert demo_offset() == offset

    # 처음으로: 실제 시각
    assert client.post(f"{V}/patients/me/demo/reset", headers=dev).status_code == 200
    assert client.get(f"{V}/demo/now").json()["offset_seconds"] == 0


def test_demo_next_without_more_doses_and_auth(client: TestClient, demo: None):
    dev, g = _elder(client)
    assert client.post(f"{V}/patients/me/demo/next").status_code == 401
    # 남은 예정 회차를 다 넘기면 NO_NEXT_DOSE
    for _ in range(10):
        res = client.post(f"{V}/patients/me/demo/next", headers=dev)
        if res.status_code != 200:
            break
    assert res.status_code == 404 and res.json()["code"] == "NO_NEXT_DOSE"


def test_demo_off_ignores_clock_and_rejects(client: TestClient):
    assert get_settings().demo_any_day is False
    set_demo_offset(86400 * 3)  # DB 에 남은 값이 있어도
    try:
        assert abs((now_local() - datetime.now()).total_seconds()) < 86400  # 실제 시각만 쓴다
        dev, _ = _elder(client)
        res = client.post(f"{V}/patients/me/demo/next", headers=dev)
        assert res.status_code == 404 and res.json()["code"] == "DEMO_OFF"
    finally:
        set_demo_offset(0)
