import secrets
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import DoseStatus, MealTiming, Slot
from app.main import app
from app.models import DoseLog, DoseSlot, DrugInfo, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers.verifications import get_photo_analyzer
from app.security import token_hash
from app.services import gemini
from app.services.dose_photo import parse_analysis
from app.services.gemini import GeminiUnavailableError, generate_json
from app.services.pill_appearance import Appearance, ExpectedPill, appearance_from_mfds, compare

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WHITE_ROUND = {"ITEM_SEQ": "1", "DRUG_SHAPE": "원형", "COLOR_CLASS1": "하양", "COLOR_CLASS2": None}
YELLOW_OVAL = {"ITEM_SEQ": "2", "DRUG_SHAPE": "타원형", "COLOR_CLASS1": "노랑", "COLOR_CLASS2": None}


def pill(colors: list[str], shape: str, certain: bool = True) -> dict[str, Any]:
    return {"colors": colors, "shape": shape, "certain": certain}


def ai(bag_time: str = "LUNCH", pills: list[dict[str, Any]] | None = None, problem: str = "NONE") -> dict[str, Any]:
    return {"bag_time_text": "점심", "bag_time": bag_time, "pills": pills or [], "image_problem": problem}


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def use_ai(raw: dict[str, Any]) -> list[bytes]:
    """사진 분석을 raw(Gemini 응답 모양)로 고정합니다. 받은 사진을 담는 목록을 돌려줍니다."""
    calls: list[bytes] = []

    def fake(image: bytes, mime_type: str):
        assert mime_type == "image/jpeg"
        calls.append(image)
        return parse_analysis(raw)

    app.dependency_overrides[get_photo_analyzer] = lambda: fake
    return calls


def make_slot(
    pill_infos: list[dict[str, Any] | None],
    *,
    slot: Slot = Slot.LUNCH,
    status: DoseStatus = DoseStatus.PENDING,
) -> dict[str, Any]:
    """약 1알씩인 처방과 회차 하나를 만들고 {patient_id, slot_id, headers} 를 돌려줍니다."""
    raw_token = secrets.token_urlsafe(16)
    with SessionLocal() as db:
        guardian = Guardian(email=f"{raw_token}@example.com", password_hash="x", name="보호자")
        patient = Patient(guardian=guardian, name="어르신", device_token=token_hash(raw_token))
        prescription = Prescription(patient=patient, start_date=now_local().date(), days=1, image_path=None, ai_json={})
        db.add_all([guardian, patient, prescription])
        for i, info in enumerate(pill_infos):
            item_seq = None
            if info is not None:
                item_seq = f"{raw_token[:8]}-{i}"
                db.add(DrugInfo(item_seq=item_seq, item_name=f"약{i}", normalized_name=f"약{i}", dur_json={}, pill_json=info))
            db.add(
                PrescriptionDrug(
                    prescription=prescription,
                    item_seq=item_seq,
                    drug_name=f"약{i}",
                    count_per_dose=1,
                    slots=[slot.value],
                    meal_timing=MealTiming.AFTER,
                )
            )
        dose_slot = DoseSlot(
            prescription=prescription,
            patient=patient,
            slot_date=now_local().date(),
            slot=slot,
            expected_count=len(pill_infos),
            status=status,
        )
        db.add(dose_slot)
        db.commit()
        return {"patient_id": patient.id, "slot_id": dose_slot.id, "headers": {"X-Device-Token": raw_token}}


def post_photo(client: TestClient, s: dict[str, Any], *, photo: bytes = JPEG, headers: dict[str, str] | None = None):
    return client.post(
        f"/api/v1/patients/{s['patient_id']}/dose-slots/{s['slot_id']}/verifications",
        files={"photo": ("dose.jpg", photo, "image/jpeg")},
        headers=s["headers"] if headers is None else headers,
    )


def slot_state(slot_id: int) -> tuple[DoseStatus, list[DoseLog]]:
    with SessionLocal() as db:
        dose_slot = db.get(DoseSlot, slot_id)
        assert dose_slot is not None
        return dose_slot.status, list(dose_slot.logs)


# ── 응답 예시별 ──


def test_ok_when_colors_and_shapes_match(client: TestClient):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["흰색"], "원형"), pill(["노란색"], "타원형")]))

    res = post_photo(client, s)

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    data = body["data"]
    assert data["result_code"] == "OK"
    assert data["verified"] is True
    assert data["ai_extracted"] == {
        "bag_time": "LUNCH",
        "pill_count": 2,
        "pills": [{"color": "흰색", "shape": "원형"}, {"color": "노란색", "shape": "타원형"}],
    }
    assert data["appearance_check"] == {"status": "MATCH", "expected_count": 2, "detected_count": 2, "warnings": []}
    assert data["verified_at"].endswith("+09:00")
    assert data["message"] == "점심 약 복용 인증이 완료되었습니다."

    status, logs = slot_state(s["slot_id"])
    assert status == DoseStatus.DONE
    assert [log.result for log in logs] == ["OK"]
    assert (Path(get_settings().upload_dir) / logs[0].photo_path).read_bytes() == JPEG


def test_appearance_mismatch_warns_missing_and_unexpected(client: TestClient):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["흰색"], "원형"), pill(["파란색"], "원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "APPEARANCE_MISMATCH"
    assert data["verified"] is False
    assert data["appearance_check"] == {
        "status": "MISMATCH",
        "expected_count": 2,
        "detected_count": 2,
        "warnings": [
            {
                "warning_type": "MISSING_PILL",
                "expected_color": "노란색",
                "expected_shape": "타원형",
                "message": "등록된 노란색 타원형 알약이 사진에서 확인되지 않아요.",
            },
            {
                "warning_type": "UNEXPECTED_PILL",
                "detected_color": "파란색",
                "detected_shape": "원형",
                "message": "등록된 약과 다른 색상 또는 모양의 알약이 보여요.",
            },
        ],
    }
    assert "verified_at" not in data
    assert data["message"].startswith("알약의 색상이나 모양이 등록된 정보와 달라요.")
    status, logs = slot_state(s["slot_id"])
    assert status == DoseStatus.PENDING
    assert [log.result for log in logs] == ["APPEARANCE_MISMATCH"]


def test_same_look_drugs_are_checked_by_count_only(client: TestClient):
    s = make_slot([WHITE_ROUND, {**WHITE_ROUND, "ITEM_SEQ": "3"}])
    use_ai(ai(pills=[pill(["흰색"], "원형"), pill(["흰색"], "원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "OK"
    assert data["verified"] is True
    assert data["appearance_check"] == {"status": "COUNT_ONLY", "expected_count": 2, "detected_count": 2, "warnings": []}
    assert data["message"] == "알약 2개가 확인되었어요. 색상과 모양이 같아 약 종류는 구별하지 못했어요."


def test_drug_without_mfds_info_is_count_only(client: TestClient):
    s = make_slot([None, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["분홍색"], "원형"), pill(["노란색"], "타원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "OK"
    assert data["appearance_check"]["status"] == "COUNT_ONLY"
    assert "색상·모양 정보가 없어" in data["message"]


def test_unclear_pill_asks_retake(client: TestClient):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["흰색"], "원형"), pill(["노란색"], "타원형", certain=False)]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "RETAKE"
    assert data["verified"] is False
    assert data["appearance_check"] == {"status": "RETAKE", "warnings": []}
    assert data["message"] == "알약의 색상과 모양을 정확히 확인하기 어려워요. 다시 촬영해 주세요."
    assert slot_state(s["slot_id"])[0] == DoseStatus.PENDING


@pytest.mark.parametrize("raw", [ai(problem="BLURRY", pills=[pill(["흰색"], "원형")]), ai(pills=[])])
def test_bad_photo_asks_retake(client: TestClient, raw: dict[str, Any]):
    s = make_slot([WHITE_ROUND])
    use_ai(raw)
    assert post_photo(client, s).json()["data"]["result_code"] == "RETAKE"


def test_unreadable_bag_time_asks_retake(client: TestClient):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(bag_time="UNKNOWN", pills=[pill(["흰색"], "원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "RETAKE"
    assert "약봉투의 시간 표시" in data["message"]


def test_other_slot_bag_is_wrong_time(client: TestClient):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(bag_time="DINNER", pills=[pill(["흰색"], "원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "WRONG_TIME"
    assert data["message"] == "저녁 약봉투예요. 점심 약봉투인지 확인해 주세요."
    assert slot_state(s["slot_id"])[0] == DoseStatus.PENDING


def test_missing_pill_is_count_mismatch_with_warning(client: TestClient):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["흰색"], "원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "COUNT_MISMATCH"
    assert data["message"] == "알약이 1개 모자라요. 2개가 맞는지 다시 세어 주세요."
    check = data["appearance_check"]
    assert (check["expected_count"], check["detected_count"]) == (2, 1)
    assert [w["expected_color"] for w in check["warnings"]] == ["노란색"]


def test_done_slot_is_already_taken_without_ai(client: TestClient):
    s = make_slot([WHITE_ROUND], status=DoseStatus.DONE)
    calls = use_ai(ai(pills=[pill(["흰색"], "원형")]))

    data = post_photo(client, s).json()["data"]

    assert data["result_code"] == "ALREADY_TAKEN"
    assert data["verified"] is False
    assert "appearance_check" not in data
    assert calls == []
    assert [log.result for log in slot_state(s["slot_id"])[1]] == ["ALREADY_TAKEN"]


def test_device_token_in_bearer_header_is_accepted(client: TestClient):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(pills=[pill(["흰색"], "원형")]))

    res = post_photo(client, s, headers={"Authorization": f"Bearer {s['headers']['X-Device-Token']}"})

    assert res.status_code == 200
    assert res.json()["data"]["result_code"] == "OK"


# ── 실패 응답 ──


def assert_error(res, status_code: int, code: str) -> None:
    assert res.status_code == status_code, res.text
    body = res.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    assert body["error"]["message"]


def test_errors(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND])
    other = make_slot([WHITE_ROUND])
    calls = use_ai(ai(pills=[pill(["흰색"], "원형")]))

    assert_error(post_photo(client, s, headers={}), 401, "UNAUTHORIZED")
    assert_error(post_photo(client, s, headers={"X-Device-Token": "wrong"}), 401, "UNAUTHORIZED")
    # 다른 어르신의 patient_id
    assert_error(post_photo(client, {**other, "headers": s["headers"]}), 403, "FORBIDDEN")
    # 없는 회차, 다른 어르신의 회차
    assert_error(post_photo(client, {**s, "slot_id": 999_999}), 404, "DOSE_SLOT_NOT_FOUND")
    assert_error(post_photo(client, {**s, "slot_id": other["slot_id"]}), 404, "DOSE_SLOT_NOT_FOUND")

    url = f"/api/v1/patients/{s['patient_id']}/dose-slots/{s['slot_id']}/verifications"
    assert_error(client.post(url, headers=s["headers"]), 400, "INVALID_REQUEST")
    assert_error(post_photo(client, s, photo=b"not an image"), 400, "INVALID_REQUEST")
    assert_error(post_photo(client, s, photo=b""), 400, "INVALID_REQUEST")
    assert_error(client.post("/api/v1/patients/abc/dose-slots/1/verifications", headers=s["headers"]), 400, "INVALID_REQUEST")

    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    assert_error(post_photo(client, s, photo=JPEG + b"\x00" * (1024 * 1024)), 413, "FILE_TOO_LARGE")
    monkeypatch.undo()

    assert calls == []
    assert slot_state(s["slot_id"]) == (DoseStatus.PENDING, [])


def test_ai_failure_is_503_and_keeps_slot(client: TestClient):
    s = make_slot([WHITE_ROUND])

    def broken(image: bytes, mime_type: str):
        raise GeminiUnavailableError("down")

    app.dependency_overrides[get_photo_analyzer] = lambda: broken
    assert_error(post_photo(client, s), 503, "AI_SERVICE_UNAVAILABLE")
    assert slot_state(s["slot_id"]) == (DoseStatus.PENDING, [])


def test_unexpected_error_is_500(client: TestClient):
    s = make_slot([WHITE_ROUND])

    def crash(image: bytes, mime_type: str):
        raise RuntimeError("bug")

    app.dependency_overrides[get_photo_analyzer] = lambda: crash
    assert_error(post_photo(client, s), 500, "INTERNAL_SERVER_ERROR")


def test_other_routers_keep_their_error_format(client: TestClient):
    res = client.post("/api/v1/patients", json={})
    assert res.status_code == 401
    assert "detail" in res.json()


# ── 색·모양 비교 규칙 ──

WHITE = Appearance(("흰색",), "원형")
YELLOW = Appearance(("노란색",), "타원형")
CAPSULE = Appearance(("빨간색", "흰색"), "장방형")


def test_appearance_from_mfds_accepts_raw_shapes():
    assert appearance_from_mfds(WHITE_ROUND) == WHITE
    assert appearance_from_mfds({"body": {"items": [YELLOW_OVAL]}}) == YELLOW
    assert appearance_from_mfds([{"drug_shape": "장방형", "color_class1": "빨강", "color_class2": "하양"}]) == CAPSULE
    assert appearance_from_mfds({"DRUG_SHAPE": "기타", "COLOR_CLASS1": "하양"}) is None
    assert appearance_from_mfds({}) is None
    assert appearance_from_mfds(None) is None


def test_compare_two_tone_capsule_seen_as_one_color_matches():
    expected = [ExpectedPill(1, CAPSULE), ExpectedPill(2, WHITE)]
    check = compare(expected, [Appearance(("빨간색",), "장방형"), WHITE], 2)
    assert check.status == "MATCH"


def test_compare_flags_shortage_inside_known_drug_even_if_total_matches():
    # A 2알 + B 1알 이어야 하는데 A 1알 + B 2알: 총 개수는 같지만 A 가 모자람
    expected = [ExpectedPill(1, WHITE), ExpectedPill(1, WHITE), ExpectedPill(2, YELLOW)]
    check = compare(expected, [WHITE, YELLOW, YELLOW], 3)
    assert check.status == "MISMATCH"
    assert [(g.look, g.count, g.seen) for g in check.missing] == [(WHITE, 1, 1)]
    assert check.unexpected == ()


def test_compare_unknown_drug_absorbs_one_stranger_only():
    expected = [ExpectedPill(1, None), ExpectedPill(2, YELLOW)]
    pink = Appearance(("분홍색",), "원형")
    blue = Appearance(("파란색",), "원형")
    assert compare(expected, [pink, YELLOW], 2).status == "COUNT_ONLY"

    check = compare(expected, [pink, blue], 2)
    assert check.status == "MISMATCH"
    assert [g.look for g in check.missing] == [YELLOW]
    assert [g.look for g in check.unexpected] == [pink, blue]


# ── Gemini 호출 ──


def test_generate_json_reads_answer_and_skips_thoughts(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    sent: dict[str, Any] = {}

    def fake_post(url: str, **kwargs: Any) -> httpx2.Response:
        sent.update(url=url, **kwargs)
        parts = [{"text": "생각 중", "thought": True}, {"text": '{"bag_time": "LUNCH"}'}]
        return httpx2.Response(200, json={"candidates": [{"content": {"parts": parts}}]})

    monkeypatch.setattr(gemini.httpx2, "post", fake_post)
    result = generate_json(image=JPEG, mime_type="image/jpeg", prompt="p", schema={"type": "object"})

    assert result == {"bag_time": "LUNCH"}
    assert sent["url"].endswith(f"/models/{get_settings().gemini_model}:generateContent")
    assert sent["headers"] == {"x-goog-api-key": "test-key"}
    assert sent["json"]["generationConfig"]["responseJsonSchema"] == {"type": "object"}


@pytest.mark.parametrize(
    "response",
    [httpx2.Response(500, text="err"), httpx2.Response(200, json={"candidates": []}), httpx2.Response(200, text="x")],
)
def test_generate_json_failures_raise_unavailable(monkeypatch: pytest.MonkeyPatch, response: httpx2.Response):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    monkeypatch.setattr(gemini.httpx2, "post", lambda url, **kwargs: response)
    with pytest.raises(GeminiUnavailableError):
        generate_json(image=JPEG, mime_type="image/jpeg", prompt="p", schema={})


def test_generate_json_without_key_is_unavailable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    with pytest.raises(GeminiUnavailableError):
        generate_json(image=JPEG, mime_type="image/jpeg", prompt="p", schema={})
