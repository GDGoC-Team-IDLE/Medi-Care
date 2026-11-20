import base64
import json
from uuid import uuid4

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.main import app
from app.models import DoseLog, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import prescription_analysis
from app.security import create_access_token, token_hash
from app.services import gemini

URL = "/api/v1/prescriptions/analyze"
JPEG = b"\xff\xd8\xff\xe0test"
PNG = b"\x89PNG\r\n\x1a\ntest"
WEBP = b"RIFF\x00\x00\x00\x00WEBPtest"
DRUG = {
    "name": "타이레놀정500밀리그람",
    "count_per_dose": 1,
    "slots": ["MORNING", "DINNER"],
    "meal_timing": "AFTER",
    "days": 3,
}


@pytest.fixture
def analysis_client(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    device_token = uuid4().hex
    with TestClient(app) as client:
        with SessionLocal.begin() as db:
            guardian = Guardian(email=f"{uuid4().hex}@example.com", name="보호자", password_hash="unused")
            db.add(Patient(guardian=guardian, name="복용자", device_token=token_hash(device_token)))
            db.flush()
            guardian_auth = {"Authorization": f"Bearer {create_access_token(guardian.id)}"}
        yield client, guardian_auth, {"X-Device-Token": device_token}


def analysis_result(raw):
    return httpx2.Response(200, json={"candidates": [
        {"content": {"parts": [{"text": json.dumps(raw)}]}},
    ]})


def test_preview_accepts_both_auth_modes_without_saving(analysis_client, monkeypatch):
    client, guardian, device = analysis_client
    sent = []
    drugs = [DRUG, {**DRUG, "name": "뮤테란캡슐100밀리그램", "slots": ["MORNING", "LUNCH", "DINNER"]}]
    raw = {"drugs": drugs, "dispensed_date": "2026-11-20", "confidence": 0.92}

    def analyze(url, **options):
        assert url.endswith(":generateContent")
        assert options["headers"] == {"x-goog-api-key": "test-key"}
        inline = options["json"]["contents"][0]["parts"][0]["inlineData"]
        sent.append((inline["mimeType"], base64.b64decode(inline["data"])))
        return analysis_result(raw)

    monkeypatch.setattr(gemini.httpx2, "post", analyze)

    def counts():
        with SessionLocal() as db:
            return [db.scalar(select(func.count()).select_from(model)) for model in (Prescription, PrescriptionDrug, DoseLog)]

    initial = counts()
    for headers, photo, media_type in [
        ({**guardian, "X-Device-Token": "wrong"}, JPEG, "image/jpeg"),
        ({**device, "Authorization": "Bearer wrong"}, PNG, "image/png"),
        (device, WEBP, "image/webp"),
    ]:
        response = client.post(URL, headers=headers, files={"image": ("package", photo, media_type)})
        assert response.status_code == 200
        assert response.json() == {
            **raw, "needs_retake": False, "message": "약 2개를 찾았어요. 내용이 맞는지 확인해 주세요.",
        }
    assert sent == [("image/jpeg", JPEG), ("image/png", PNG), ("image/webp", WEBP)]
    assert initial == counts()


def test_unclear_or_invalid_extraction_requests_a_retake(analysis_client, monkeypatch):
    client, auth, _ = analysis_client
    files = {"image": ("package.jpg", JPEG, "image/jpeg")}
    low = analysis_result({"drugs": [DRUG], "dispensed_date": "2026-11-20", "confidence": 0.31})
    invalid = analysis_result({
        "drugs": [{**DRUG, "count_per_dose": 0.5}], "dispensed_date": None, "confidence": 0.92,
    })
    unreadable = httpx2.Response(200, json={"candidates": []})
    for upstream, confidence in [(low, 0.31), (invalid, 0.0), (unreadable, 0.0)]:
        monkeypatch.setattr(gemini.httpx2, "post", lambda *args, **kwargs: upstream)
        response = client.post(URL, headers=auth, files=files)
        assert response.status_code == 200
        assert response.json() == {
            "drugs": [],
            "dispensed_date": None,
            "confidence": confidence,
            "needs_retake": True,
            "message": "글씨가 잘 보이지 않아요. 밝은 곳에서 봉투 전체가 나오게 다시 찍어 주세요.",
        }


def test_analysis_errors_match_the_contract(analysis_client, monkeypatch):
    client, auth, _ = analysis_client
    calls = []

    def unavailable(*args, **kwargs):
        calls.append(1)
        return httpx2.Response(503)

    monkeypatch.setattr(gemini.httpx2, "post", unavailable)
    photo = {"image": ("package.jpg", JPEG, "image/jpeg")}
    for response, status, code, message in [
        (client.post(URL, files=photo), 401, "UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
        (client.post(URL, headers=auth), 400, "IMAGE_REQUIRED", "사진을 첨부해 주세요."),
        (client.post(URL, headers=auth, files={"image": ("empty.jpg", b"")}), 400, "IMAGE_REQUIRED", "사진을 첨부해 주세요."),
        (client.post(URL, headers=auth, files={"image": ("fake.jpg", b"GIF89a", "image/jpeg")}), 415,
         "UNSUPPORTED_IMAGE_TYPE", "jpg, png, webp 사진만 올릴 수 있어요."),
        (client.post(URL, headers=auth, files={"image": ("large.jpg", JPEG + b"x" * (10 * 1024 * 1024))}),
         413, "IMAGE_TOO_LARGE", "사진은 10MB 이하만 올릴 수 있어요."),
    ]:
        assert response.status_code == status
        assert response.json() == {"code": code, "message": message}
    assert calls == []
    response = client.post(URL, headers=auth, files=photo)
    assert response.status_code == 503
    assert response.json() == {"code": "AI_UNAVAILABLE", "message": "지금 사진 분석을 할 수 없어요. 잠시 후 다시 시도해 주세요."}

    def fail(*args):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(prescription_analysis, "analyze_prescription_photo", fail)
    response = client.post(URL, headers=auth, files=photo)
    assert response.status_code == 500
    assert response.json() == {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했어요."}
