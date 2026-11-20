import secrets
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.enums import DoseStatus, MealTiming, Slot
from app.main import app
from app.models import (
    DoseLog,
    DoseSlot,
    DrugInfo,
    Guardian,
    GuardianAlert,
    Patient,
    Prescription,
    PrescriptionDrug,
    PushToken,
)
from app.routers import verifications
from app.routers.verifications import get_photo_analyzer
from app.security import create_access_token, token_hash
from app.services.expo_push import ExpoPushError, ExpoPushResult
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
    days_ago: int = 0,
) -> dict[str, Any]:
    """약 1알씩인 처방과 회차 하나를 만들고 {patient_id, guardian_id, slot_id, headers} 를 돌려줍니다."""
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
            slot_date=now_local().date() - timedelta(days=days_ago),
            slot=slot,
            expected_count=len(pill_infos),
            status=status,
        )
        db.add(dose_slot)
        db.commit()
        return {
            "patient_id": patient.id,
            "guardian_id": guardian.id,
            "slot_id": dose_slot.id,
            "headers": {"X-Device-Token": raw_token},
        }


def post_photo(
    client: TestClient,
    s: dict[str, Any],
    *,
    photo: bytes = JPEG,
    headers: dict[str, str] | None = None,
    patient_id: Any = "me",
):
    return client.post(
        f"/api/v1/patients/{patient_id}/dose-slots/{s['slot_id']}/verifications",
        files={"image": ("dose.jpg", photo, "image/jpeg")},
        headers=s["headers"] if headers is None else headers,
    )


def guardian_headers(s: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(s['guardian_id'])}"}


def push_token(s: dict[str, Any], name: str) -> str:
    return f"ExponentPushToken[{name}-{s['guardian_id']}]"  # expo_token 은 DB 전체에서 UNIQUE


def capture_pushes(monkeypatch: pytest.MonkeyPatch, s: dict[str, Any], *names: str) -> list[dict[str, Any]]:
    """보호자 기기 토큰을 등록하고, 보낸 WRONG_DOSE 푸시를 담는 목록을 돌려줍니다."""
    with SessionLocal() as db:
        db.add_all(PushToken(guardian_id=s["guardian_id"], expo_token=push_token(s, n)) for n in names)
        db.commit()
    sent: list[dict[str, Any]] = []

    def fake_send(tokens: list[str], **kwargs: Any) -> ExpoPushResult:
        sent.append({"tokens": tokens, **kwargs})
        return ExpoPushResult(accepted=len(tokens))

    monkeypatch.setattr(verifications, "send_expo_push", fake_send)
    return sent


def slot_state(slot_id: int) -> tuple[DoseStatus, list[DoseLog]]:
    with SessionLocal() as db:
        dose_slot = db.get(DoseSlot, slot_id)
        assert dose_slot is not None
        return dose_slot.status, list(dose_slot.logs)


def alert_rows(slot_id: int) -> list[GuardianAlert]:
    with SessionLocal() as db:
        return list(
            db.scalars(select(GuardianAlert).where(GuardianAlert.dose_slot_id == slot_id).order_by(GuardianAlert.id))
        )


# ── 응답 예시별 ──


def test_demo_any_day_verifies_tomorrow_slot(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    tomorrow = make_slot([WHITE_ROUND], days_ago=-1)
    use_ai(ai(pills=[pill(["하양"], "원형")]))

    # 기본: 오늘이 아닌 회차는 받지 않는다
    assert_error(post_photo(client, tomorrow), 409, "SLOT_NOT_TODAY")
    # 시연 설정(DEMO_ANY_DAY): 내일 회차도 인증된다
    monkeypatch.setattr(get_settings(), "demo_any_day", True)
    res = post_photo(client, tomorrow)
    assert res.status_code == 200, res.text
    assert res.json()["result"] == "OK"


def test_ok_when_colors_and_shapes_match(client: TestClient):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["하양"], "원형"), pill(["노랑"], "타원형")]))

    res = post_photo(client, s)

    assert res.status_code == 200
    data = res.json()
    status, logs = slot_state(s["slot_id"])
    assert data == {
        "dose_log_id": logs[0].id,
        "slot_id": s["slot_id"],
        "slot": "LUNCH",
        "result": "OK",
        "slot_status": "DONE",
        "ai_extracted": {
            "bag_slot": "LUNCH",
            "pill_count": 2,
            "pills": [{"color": "하양", "shape": "원형"}, {"color": "노랑", "shape": "타원형"}],
        },
        "expected": {"slot": "LUNCH", "pill_count": 2},
        "appearance_check": {"status": "MATCH", "warnings": []},
        "taken_at": data["taken_at"],
        "photo_url": None,  # 로컬 저장이라 서명 URL 없음
        "message": "점심 약 복용 인증이 완료되었어요.",
    }
    assert data["taken_at"].endswith("+09:00")
    assert status == DoseStatus.DONE
    assert [log.result for log in logs] == ["OK"]
    assert (Path(get_settings().upload_dir) / logs[0].photo_path).read_bytes() == JPEG


def test_ok_keeps_result_but_warns_missing_and_unexpected(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    sent = capture_pushes(monkeypatch, s, "a")
    use_ai(ai(pills=[pill(["하양"], "원형"), pill(["파랑"], "원형")]))

    data = post_photo(client, s).json()

    assert (data["result"], data["slot_status"]) == ("OK", "DONE")
    assert data["appearance_check"] == {
        "status": "MISMATCH",
        "warnings": [
            {
                "type": "MISSING_PILL",
                "drug_name": "약1",
                "expected_color": "노랑",
                "expected_shape": "타원형",
                "message": "노란색 타원형 알약이 사진에서 보이지 않아요.",
            },
            {
                "type": "UNEXPECTED_PILL",
                "detected_color": "파랑",
                "detected_shape": "원형",
                "message": "등록된 약과 다른 모양의 알약이 보여요.",
            },
        ],
    }
    assert data["message"] == "인증은 됐어요. 다만 알약 색이나 모양이 등록된 약과 달라 보여요. 약봉투를 한 번 더 확인해 주세요."
    assert data["taken_at"] is not None
    assert sent == []  # OK 는 보호자 알림 없음
    status, logs = slot_state(s["slot_id"])
    assert status == DoseStatus.DONE
    assert [log.result for log in logs] == ["OK"]


def test_same_look_drugs_are_checked_by_count_only(client: TestClient):
    s = make_slot([WHITE_ROUND, {**WHITE_ROUND, "ITEM_SEQ": "3"}])
    use_ai(ai(pills=[pill(["하양"], "원형"), pill(["하양"], "원형")]))

    data = post_photo(client, s).json()

    assert data["result"] == "OK"
    assert data["appearance_check"] == {"status": "COUNT_ONLY", "warnings": []}
    assert data["message"] == "점심 약 복용 인증이 완료되었어요."


def test_drug_without_mfds_info_is_unknown(client: TestClient):
    s = make_slot([None, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["분홍"], "원형"), pill(["노랑"], "타원형")]))

    data = post_photo(client, s).json()

    assert data["result"] == "OK"
    assert data["appearance_check"] == {"status": "UNKNOWN", "warnings": []}


def test_unclear_pill_color_does_not_block_ok(client: TestClient):
    # 색이 애매한 알약이 있어도 개수·봉투가 맞으면 OK. 색·모양 대조만 UNKNOWN.
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    use_ai(ai(pills=[pill(["하양"], "원형"), pill(["노랑"], "타원형", certain=False)]))

    data = post_photo(client, s).json()

    assert (data["result"], data["slot_status"]) == ("OK", "DONE")
    assert data["appearance_check"] == {"status": "UNKNOWN", "warnings": []}


@pytest.mark.parametrize(
    "raw",
    [
        ai(problem="BLURRY", pills=[pill(["하양"], "원형")]),
        ai(pills=[], problem="NO_PILLS"),
        ai(bag_time="UNKNOWN", pills=[pill(["하양"], "원형")]),
    ],
)
def test_unreadable_photo_asks_retake_without_log(client: TestClient, monkeypatch: pytest.MonkeyPatch, raw: dict[str, Any]):
    s = make_slot([WHITE_ROUND])
    sent = capture_pushes(monkeypatch, s, "a")
    use_ai(raw)

    data = post_photo(client, s).json()

    assert data["result"] == "RETAKE"
    assert data["slot_status"] == "PENDING"
    assert (data["dose_log_id"], data["photo_url"], data["taken_at"], data["appearance_check"]) == (None, None, None, None)
    assert data["expected"] == {"slot": "LUNCH", "pill_count": 1}
    assert data["message"] == "사진을 정확하게 확인하기 어려워요. 약봉투와 알약이 잘 보이게 다시 찍어 주세요."
    assert slot_state(s["slot_id"]) == (DoseStatus.PENDING, [])
    assert sent == []


def test_retake_example_has_null_extracted_values(client: TestClient):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(bag_time="UNKNOWN", pills=[], problem="NO_PILLS"))

    data = post_photo(client, s).json()

    assert data["ai_extracted"] == {"bag_slot": None, "pill_count": None, "pills": []}


def test_other_slot_bag_is_wrong_time_and_alerts_guardian(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND])
    sent = capture_pushes(monkeypatch, s, "a")
    use_ai(ai(bag_time="MORNING", pills=[pill(["하양"], "원형")]))

    data = post_photo(client, s).json()

    assert (data["result"], data["slot_status"]) == ("WRONG_TIME", "WRONG")
    assert data["ai_extracted"]["bag_slot"] == "MORNING"
    assert (data["appearance_check"], data["taken_at"]) == (None, None)
    assert data["message"] == "점심 약을 인증하는 중이에요. 사진에는 아침 약봉투가 보여요. 약봉투를 다시 확인해 주세요."
    status, logs = slot_state(s["slot_id"])
    assert status == DoseStatus.WRONG
    assert [(log.id, log.result) for log in logs] == [(data["dose_log_id"], "WRONG_TIME")]
    [alert] = alert_rows(s["slot_id"])
    assert (alert.type, alert.dose_log_id, alert.guardian_id, alert.patient_id) == (
        "WRONG_DOSE",
        data["dose_log_id"],
        s["guardian_id"],
        s["patient_id"],
    )
    assert alert.push_sent_at is not None and alert.push_error is None
    assert sent == [
        {
            "tokens": [push_token(s, "a")],
            "title": "복약 확인이 필요해요",
            "body": "어르신님이 점심 약 대신 아침 약봉투를 찍었어요. 확인해 주세요.",
            "data": {
                "type": "WRONG_DOSE",
                "alert_id": alert.id,
                "result": "WRONG_TIME",
                "patient_id": s["patient_id"],
                "slot_id": s["slot_id"],
                "dose_log_id": data["dose_log_id"],
                "route": "/guardian/g03-wrong",
            },
        }
    ]


def test_count_mismatch_marks_wrong_and_can_retry_to_done(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND, YELLOW_OVAL])
    sent = capture_pushes(monkeypatch, s, "a")
    use_ai(ai(pills=[pill(["하양"], "원형")]))

    data = post_photo(client, s).json()

    assert (data["result"], data["slot_status"]) == ("COUNT_MISMATCH", "WRONG")
    assert data["ai_extracted"]["pill_count"] == 1
    assert data["appearance_check"] is None
    assert data["message"] == "사진에서 알약 1개가 보여요. 등록된 개수는 2개예요. 약봉투 안을 다시 확인해 주세요."
    assert [p["data"]["result"] for p in sent] == ["COUNT_MISMATCH"]

    # WRONG 회차는 다시 인증할 수 있고, OK 면 DONE
    use_ai(ai(pills=[pill(["하양"], "원형"), pill(["노랑"], "타원형")]))
    data = post_photo(client, s).json()

    assert (data["result"], data["slot_status"]) == ("OK", "DONE")
    status, logs = slot_state(s["slot_id"])
    assert status == DoseStatus.DONE
    assert [log.result for log in logs] == ["COUNT_MISMATCH", "OK"]
    assert len(sent) == 1
    assert [(a.type, a.dose_log_id) for a in alert_rows(s["slot_id"])] == [("WRONG_DOSE", logs[0].id)]


def test_every_wrong_attempt_is_kept_in_guardian_alerts(client: TestClient):
    # 같은 회차에서도 오복용 시도마다 알림 내역이 남습니다 (보호자 기기 토큰이 없어도 기록은 남음).
    s = make_slot([WHITE_ROUND])
    for raw in (ai(bag_time="MORNING", pills=[pill(["하양"], "원형")]), ai(pills=[pill(["하양"], "원형")] * 2)):
        use_ai(raw)
        post_photo(client, s)
    use_ai(ai(pills=[pill(["하양"], "원형")]))
    assert post_photo(client, s).json()["result"] == "OK"
    assert post_photo(client, s).json()["result"] == "ALREADY_TAKEN"

    logs = slot_state(s["slot_id"])[1]
    assert [log.result for log in logs] == ["WRONG_TIME", "COUNT_MISMATCH", "OK", "ALREADY_TAKEN"]
    alerts = alert_rows(s["slot_id"])
    assert [(a.type, a.dose_log_id) for a in alerts] == [
        ("WRONG_DOSE", logs[0].id),
        ("WRONG_DOSE", logs[1].id),
        ("WRONG_DOSE", logs[3].id),
    ]
    assert all(a.push_sent_at is None for a in alerts)


def test_unique_index_skips_only_wrong_dose(client: TestClient):
    s = make_slot([WHITE_ROUND])
    insert = text(
        "INSERT INTO guardian_alerts (guardian_id, patient_id, dose_slot_id, type, title, body, created_at) "
        "VALUES (:guardian_id, :patient_id, :slot_id, :type, 't', 'b', CURRENT_TIMESTAMP)"
    )
    params = {"guardian_id": s["guardian_id"], "patient_id": s["patient_id"], "slot_id": s["slot_id"]}
    once_types = ("MISSED", "WELFARE_CHECK", "MEDICATION_LOW", "DOSE_NO_RESPONSE")
    with SessionLocal() as db:
        for alert_type in ("WRONG_DOSE", "WRONG_DOSE", *once_types):
            db.execute(insert, {**params, "type": alert_type})
        db.commit()

    for alert_type in once_types:
        with SessionLocal() as db, pytest.raises(IntegrityError):
            db.execute(insert, {**params, "type": alert_type})


def test_done_slot_is_already_taken_without_ai(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND])
    sent = capture_pushes(monkeypatch, s, "a")
    calls = use_ai(ai(pills=[pill(["하양"], "원형")]))
    first = post_photo(client, s).json()
    assert first["result"] == "OK"

    data = post_photo(client, s).json()

    assert (data["result"], data["slot_status"]) == ("ALREADY_TAKEN", "DONE")
    assert data["ai_extracted"] is None
    assert data["appearance_check"] is None
    assert data["dose_log_id"] not in (None, first["dose_log_id"])
    assert data["taken_at"] == first["taken_at"]  # 먼저 인증한 기록
    assert data["message"].startswith("점심 약은 ") and data["message"].endswith("분에 이미 드셨어요. 다시 드시지 마세요.")
    assert len(calls) == 1  # AI 는 처음 한 번만
    status, logs = slot_state(s["slot_id"])
    assert status == DoseStatus.DONE
    assert [log.result for log in logs] == ["OK", "ALREADY_TAKEN"]
    assert [(p["data"]["result"], p["data"]["dose_log_id"]) for p in sent] == [("ALREADY_TAKEN", data["dose_log_id"])]
    assert "이미 드신 점심 약" in sent[0]["body"]


def test_photo_url_is_signed_for_10_minutes_and_already_taken_shows_first(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(pills=[pill(["하양"], "원형")]))
    monkeypatch.setattr(get_settings(), "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(get_settings(), "supabase_service_role_key", "service-key")
    monkeypatch.setattr(verifications, "save_photo", lambda data, *, path, mime_type: path)
    signed: list[tuple[list[str], int]] = []

    def fake_sign(paths: list[str], expires_in: int) -> dict[str, str]:
        signed.append((paths, expires_in))
        return {p: f"https://signed/{p}?token=t" for p in paths}

    monkeypatch.setattr(verifications, "sign_dose_photos", fake_sign)

    first = post_photo(client, s).json()
    again = post_photo(client, s).json()

    first_path = slot_state(s["slot_id"])[1][0].photo_path
    assert first["photo_url"] == again["photo_url"] == f"https://signed/{first_path}?token=t"
    assert signed == [([first_path], 600), ([first_path], 600)]


def test_photo_url_is_null_when_signing_fails(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(pills=[pill(["하양"], "원형")]))
    monkeypatch.setattr(get_settings(), "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(get_settings(), "supabase_service_role_key", "service-key")
    monkeypatch.setattr(verifications, "save_photo", lambda data, *, path, mime_type: path)

    def broken_sign(paths: list[str], expires_in: int) -> dict[str, str]:
        raise OSError("down")

    monkeypatch.setattr(verifications, "sign_dose_photos", broken_sign)

    res = post_photo(client, s)

    assert res.status_code == 200
    assert (res.json()["result"], res.json()["photo_url"]) == ("OK", None)


def test_invalid_push_token_is_removed(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND], status=DoseStatus.DONE)
    capture_pushes(monkeypatch, s, "old", "new")
    monkeypatch.setattr(
        verifications,
        "send_expo_push",
        lambda tokens, **kwargs: ExpoPushResult(accepted=1, invalid_tokens=[push_token(s, "old")]),
    )
    use_ai(ai())

    assert post_photo(client, s).json()["result"] == "ALREADY_TAKEN"

    with SessionLocal() as db:
        left = db.scalars(select(PushToken.expo_token).where(PushToken.guardian_id == s["guardian_id"])).all()
    assert left == [push_token(s, "new")]


@pytest.mark.parametrize("error", [ExpoPushError("Expo Push 서비스에 연결할 수 없습니다."), RuntimeError("bug")])
def test_push_failure_does_not_change_result(client: TestClient, monkeypatch: pytest.MonkeyPatch, error: Exception):
    s = make_slot([WHITE_ROUND], status=DoseStatus.DONE)
    capture_pushes(monkeypatch, s, "a")

    def broken(tokens: list[str], **kwargs: Any) -> ExpoPushResult:
        raise error

    monkeypatch.setattr(verifications, "send_expo_push", broken)
    use_ai(ai())

    res = post_photo(client, s)

    assert res.status_code == 200
    assert res.json()["result"] == "ALREADY_TAKEN"
    [alert] = alert_rows(s["slot_id"])  # 푸시가 실패해도 알림 내역은 남음
    assert alert.push_sent_at is None
    if isinstance(error, ExpoPushError):
        assert alert.push_error == "Expo Push 서비스에 연결할 수 없습니다."


# ── 호출자 ──


def test_patient_phone_can_use_own_id_instead_of_me(client: TestClient):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(pills=[pill(["하양"], "원형")]))

    res = post_photo(client, s, patient_id=s["patient_id"])

    assert res.status_code == 200
    assert res.json()["result"] == "OK"


def test_guardian_app_can_verify_with_jwt(client: TestClient):
    s = make_slot([WHITE_ROUND])
    use_ai(ai(pills=[pill(["하양"], "원형")]))

    res = post_photo(client, s, headers=guardian_headers(s), patient_id=s["patient_id"])

    assert res.status_code == 200
    assert res.json()["result"] == "OK"
    assert slot_state(s["slot_id"])[0] == DoseStatus.DONE


# ── 실패 응답 ──


def assert_error(res, status_code: int, code: str) -> None:
    assert res.status_code == status_code, res.text
    body = res.json()
    assert set(body) == {"code", "message"}
    assert body["code"] == code
    assert body["message"]


def test_errors(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    s = make_slot([WHITE_ROUND])
    other = make_slot([WHITE_ROUND])
    yesterday = make_slot([WHITE_ROUND], days_ago=1)
    calls = use_ai(ai(pills=[pill(["하양"], "원형")]))

    assert_error(post_photo(client, s, headers={}), 401, "UNAUTHORIZED")
    assert_error(post_photo(client, s, headers={"X-Device-Token": "wrong"}), 401, "UNAUTHORIZED")
    assert_error(post_photo(client, s, headers={"Authorization": "Bearer wrong"}), 401, "UNAUTHORIZED")
    # 다른 어르신의 patient_id / 회차
    assert_error(post_photo(client, s, patient_id=other["patient_id"]), 403, "FORBIDDEN")
    assert_error(post_photo(client, {**s, "slot_id": other["slot_id"]}), 403, "FORBIDDEN")
    # 보호자: 연결되지 않은 어르신, me 사용
    assert_error(post_photo(client, other, headers=guardian_headers(s), patient_id=other["patient_id"]), 403, "FORBIDDEN")
    assert_error(post_photo(client, s, headers=guardian_headers(s), patient_id="me"), 403, "FORBIDDEN")
    # 없는 회차
    assert_error(post_photo(client, {**s, "slot_id": 999_999}), 404, "DOSE_SLOT_NOT_FOUND")
    assert_error(post_photo(client, {**s, "slot_id": "abc"}), 404, "DOSE_SLOT_NOT_FOUND")
    # 오늘이 아닌 회차
    assert_error(post_photo(client, yesterday), 409, "SLOT_NOT_TODAY")

    url = f"/api/v1/patients/me/dose-slots/{s['slot_id']}/verifications"
    assert_error(client.post(url, headers=s["headers"]), 400, "IMAGE_REQUIRED")
    assert_error(client.post(url, headers=s["headers"], data={"image": "text"}), 400, "IMAGE_REQUIRED")
    assert_error(post_photo(client, s, photo=b""), 400, "IMAGE_REQUIRED")
    assert_error(post_photo(client, s, photo=b"not an image"), 415, "UNSUPPORTED_IMAGE_TYPE")
    heic = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 32
    assert_error(post_photo(client, s, photo=heic), 415, "UNSUPPORTED_IMAGE_TYPE")

    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    assert_error(post_photo(client, s, photo=JPEG + b"\x00" * (1024 * 1024)), 413, "IMAGE_TOO_LARGE")
    monkeypatch.undo()

    assert calls == []
    assert slot_state(s["slot_id"]) == (DoseStatus.PENDING, [])


def test_ai_failure_is_503_and_keeps_slot(client: TestClient):
    s = make_slot([WHITE_ROUND])

    def broken(image: bytes, mime_type: str):
        raise GeminiUnavailableError("down")

    app.dependency_overrides[get_photo_analyzer] = lambda: broken
    assert_error(post_photo(client, s), 503, "AI_UNAVAILABLE")
    assert slot_state(s["slot_id"]) == (DoseStatus.PENDING, [])


def test_unexpected_error_is_500(client: TestClient):
    s = make_slot([WHITE_ROUND])

    def crash(image: bytes, mime_type: str):
        raise RuntimeError("bug")

    app.dependency_overrides[get_photo_analyzer] = lambda: crash
    assert_error(post_photo(client, s), 500, "INTERNAL_ERROR")


def test_other_routers_keep_their_error_format(client: TestClient):
    res = client.post("/api/v1/patients", json={})
    assert res.status_code == 401
    assert "detail" in res.json()


# ── 색·모양 비교 규칙 ──

WHITE = Appearance(("하양",), "원형")
YELLOW = Appearance(("노랑",), "타원형")
CAPSULE = Appearance(("빨강", "하양"), "장방형")


def test_appearance_from_mfds_accepts_raw_shapes():
    assert appearance_from_mfds(WHITE_ROUND) == WHITE
    assert appearance_from_mfds({"body": {"items": [YELLOW_OVAL]}}) == YELLOW
    assert appearance_from_mfds([{"drug_shape": "장방형", "color_class1": "빨강", "color_class2": "하양"}]) == CAPSULE
    assert appearance_from_mfds({"DRUG_SHAPE": "기타", "COLOR_CLASS1": "하양"}) is None
    assert appearance_from_mfds({}) is None
    assert appearance_from_mfds(None) is None


def test_compare_two_tone_capsule_seen_as_one_color_matches():
    expected = [ExpectedPill(1, CAPSULE), ExpectedPill(2, WHITE)]
    check = compare(expected, [Appearance(("빨강",), "장방형"), WHITE], 2)
    assert check.status == "MATCH"


def test_compare_flags_shortage_inside_known_drug_even_if_total_matches():
    # A 2알 + B 1알 이어야 하는데 A 1알 + B 2알: 총 개수는 같지만 A 가 모자람
    expected = [ExpectedPill(1, WHITE), ExpectedPill(1, WHITE), ExpectedPill(2, YELLOW)]
    check = compare(expected, [WHITE, YELLOW, YELLOW], 3)
    assert check.status == "MISMATCH"
    assert [(g.look, g.count, g.seen, g.drugs) for g in check.missing] == [(WHITE, 1, 1, (1,))]
    assert check.unexpected == ()


def test_compare_unknown_drug_absorbs_one_stranger_only():
    expected = [ExpectedPill(1, None), ExpectedPill(2, YELLOW)]
    pink = Appearance(("분홍",), "원형")
    blue = Appearance(("파랑",), "원형")
    assert compare(expected, [pink, YELLOW], 2).status == "UNKNOWN"

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
