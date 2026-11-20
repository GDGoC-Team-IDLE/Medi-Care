import json
from datetime import date, datetime
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.main import app
from app.models import DrugInfo, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import dur_warnings
from app.security import create_access_token, token_hash
from app.services import dur_lookup
from app.services.dur_lookup import MfdsUnavailable, fetch_dur_items, to_easy_messages

URL = "/api/v1/patients/{}/dur-warnings"
REAL_HTTPX_CLIENT = httpx.Client
TABOO = "병용금기 대상 성분 조합"
# 같은 약·상대 약·종류는 경고 하나로 합치고 원문을 이어 붙입니다 (A01→B02, B02→A01 원문이 다름).
MERGED_TABOO = "병용금기 대상 성분 조합; 횡문근융해증"
ELDERLY = "노인주의 대상 성분: 클로르페니라민"  # 식약처 노인주의는 원문이 비어 있는 경우가 많음
CLOSING = "의사나 약사에게 확인해 주세요."

# 품목기준코드별 식약처 DUR 응답 (fetch_dur_items 가 돌려주는 모양)
MFDS = {
    "A01": [
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "A01", "MIXTURE_ITEM_SEQ": "B02", "PROHBT_CONTENT": TABOO},
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "A01", "MIXTURE_ITEM_SEQ": "D04", "PROHBT_CONTENT": TABOO},
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "A01", "MIXTURE_ITEM_SEQ": "Z99", "PROHBT_CONTENT": TABOO},
        {"TYPE_NAME": "효능군중복", "ITEM_SEQ": "A01", "EFFECT_NAME": "해열진통소염제"},
    ],
    "B02": [
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "B02", "MIXTURE_ITEM_SEQ": "A01", "PROHBT_CONTENT": "횡문근융해증"},
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "B02", "MIXTURE_ITEM_SEQ": "A01", "PROHBT_CONTENT": TABOO},
        {"TYPE_NAME": "효능군중복", "ITEM_SEQ": "B02", "EFFECT_NAME": "소화성궤양용제"},
    ],
    "C03": [
        {"TYPE_NAME": "노인주의", "ITEM_SEQ": "C03", "INGR_NAME": "클로르페니라민"},
        {"TYPE_NAME": "효능군중복", "ITEM_SEQ": "C03", "EFFECT_NAME": "해열진통소염제"},
    ],
    "D04": [
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "D04", "MIXTURE_ITEM_SEQ": "A01", "PROHBT_CONTENT": TABOO},
    ],
    "E05": [],
}


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def mfds(monkeypatch):
    monkeypatch.setattr(dur_warnings, "now_local", lambda: datetime(2026, 11, 20, 14, 0, 0, 123))
    fetched: list[str] = []
    easy_requests: list[list[tuple[str, str]]] = []

    def fetch(item_seqs):
        fetched.extend(item_seqs)
        return {item_seq: MFDS[item_seq] for item_seq in item_seqs}

    def easy(warnings):
        easy_requests.append(warnings)
        return [f"쉬운 문장 {index}이에요." for index, _ in enumerate(warnings)]

    monkeypatch.setattr(dur_warnings, "fetch_dur_items", fetch)
    monkeypatch.setattr(dur_warnings, "to_easy_messages", easy)
    return fetched, easy_requests


def _seed(drugs_by_rx: list[tuple[date, int, list[tuple[str, str | None]]]]):
    """[(처방 시작일, 일수, [(약 이름, 품목기준코드)])] 로 어르신과 처방을 만듭니다."""
    device_token = uuid4().hex
    with SessionLocal() as db:
        guardian, other = [
            Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="보호자")
            for _ in range(2)
        ]
        patient = Patient(guardian=guardian, name="김순자", device_token=token_hash(device_token))
        db.add_all([patient, other])
        for start_date, days, drugs in drugs_by_rx:
            prescription = Prescription(patient=patient, start_date=start_date, days=days, ai_json={})
            for name, item_seq in drugs:
                info = None
                if item_seq is not None:
                    info = db.get(DrugInfo, item_seq) or DrugInfo(
                        item_seq=item_seq, item_name=name, normalized_name=name, dur_json={}, pill_json={}
                    )
                db.add(PrescriptionDrug(
                    prescription=prescription, drug_name=name, drug_info=info,
                    count_per_dose=1, slots=["MORNING"],
                ))
        db.commit()
        return (
            patient.id,
            {"X-Device-Token": device_token},
            {"Authorization": f"Bearer {create_access_token(guardian.id)}"},
            {"Authorization": f"Bearer {create_access_token(other.id)}"},
        )


def _clear_cache(*item_seqs):
    with SessionLocal() as db:
        for item_seq in item_seqs:
            if (info := db.get(DrugInfo, item_seq)) is not None:
                db.delete(info)
        db.commit()


def test_dur_warnings_collects_all_hospitals_and_caches(client, mfds):
    fetched, easy_requests = mfds
    _clear_cache("A01", "B02", "C03", "D04")
    patient_id, device, owner, _ = _seed([
        (date(2026, 11, 15), 14, [("예시약 A", "A01"), ("예시약 C", "C03")]),  # 내과
        (date(2026, 11, 19), 7, [("예시약 B", "B02"), ("뮤테란캡슐100밀리그램", None)]),  # 정형외과
        (date(2026, 11, 1), 10, [("끝난 약 D", "D04")]),  # 11/10 에 끝난 처방
    ])

    response = client.get(URL.format("me"), headers=device)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {
        "checked_at": "2026-11-20T14:00:00+09:00",
        "drug_count": 4,
        "warning_count": 3,
        "warnings": [
            {
                "type": "CONCOMITANT_CONTRAINDICATION",
                "drugs": ["예시약 A", "예시약 B"],
                "original_message": MERGED_TABOO,
                "easy_message": f"쉬운 문장 0이에요. {CLOSING}",
                "source": "MFDS_DUR",
            },
            {
                "type": "ELDERLY_CAUTION",
                "drugs": ["예시약 C"],
                "original_message": ELDERLY,
                "easy_message": f"쉬운 문장 1이에요. {CLOSING}",
                "source": "MFDS_DUR",
            },
            {
                "type": "DUPLICATE_EFFICACY",
                "drugs": ["예시약 A", "예시약 C"],
                "original_message": "효능군중복: 해열진통소염제",
                "easy_message": f"쉬운 문장 2이에요. {CLOSING}",
                "source": "MFDS_DUR",
            },
        ],
        "unidentified_drugs": ["뮤테란캡슐100밀리그램"],
        "message": "약을 드시기 전에 주의사항을 확인해 주세요. 약 1개는 정보를 찾지 못했으니 약사에게 확인해 주세요.",
    }
    # 끝난 처방의 약은 조회하지 않고, Gemini 에는 종류와 식약처 원문만 보냅니다.
    assert sorted(fetched) == ["A01", "B02", "C03"]
    assert easy_requests == [[
        ("CONCOMITANT_CONTRAINDICATION", MERGED_TABOO),
        ("ELDERLY_CAUTION", ELDERLY),
        ("DUPLICATE_EFFICACY", "효능군중복: 해열진통소염제"),
    ]]

    # 두 번째 조회(보호자 앱)는 식약처 응답과 쉬운 문장 모두 캐시를 씁니다.
    again = client.get(URL.format(patient_id), headers=owner)
    assert again.status_code == 200
    assert again.json()["warnings"] == response.json()["warnings"]
    assert sorted(fetched) == ["A01", "B02", "C03"]
    assert len(easy_requests) == 1
    with SessionLocal() as db:
        assert db.get(DrugInfo, "A01").dur_json["items"] == MFDS["A01"]
        # 쉬운 문장은 (경고 종류, 약, 상대 약) 단위로, 마무리 안내 없이 관련 약마다 저장합니다.
        assert db.get(DrugInfo, "A01").dur_json["easy_messages"] == {
            "CONCOMITANT_CONTRAINDICATION|A01|B02": "쉬운 문장 0이에요.",
            "DUPLICATE_EFFICACY|A01|C03": "쉬운 문장 2이에요.",
        }
        assert db.get(DrugInfo, "C03").dur_json["easy_messages"] == {
            "ELDERLY_CAUTION|C03": "쉬운 문장 1이에요.",
            "DUPLICATE_EFFICACY|A01|C03": "쉬운 문장 2이에요.",
        }

    # 다른 어르신이라도 같은 약 조합이면 Gemini 를 다시 부르지 않고 같은 문장이 나옵니다.
    _, other_device, _, _ = _seed([(date(2026, 11, 20), 3, [("다른 이름 B", "B02"), ("다른 이름 A", "A01")])])
    warning = client.get(URL.format("me"), headers=other_device).json()["warnings"][0]
    assert (warning["drugs"], warning["easy_message"]) == (["다른 이름 B", "다른 이름 A"], f"쉬운 문장 0이에요. {CLOSING}")
    assert len(easy_requests) == 1


def test_dur_warnings_without_warnings_reports_unidentified(client, mfds):
    _clear_cache("E05")
    _, device, _, _ = _seed([
        (date(2026, 11, 20), 3, [("이상 없는 약", "E05"), ("뮤테란캡슐100밀리그램", None)]),
    ])
    body = client.get(URL.format("me"), headers=device).json()
    assert body["drug_count"] == 2
    assert body["warning_count"] == 0
    assert body["warnings"] == []
    assert body["unidentified_drugs"] == ["뮤테란캡슐100밀리그램"]
    assert body["message"] == "확인된 주의사항은 없어요. 약 1개는 정보를 찾지 못했으니 약사에게 확인해 주세요."

    _, device, _, _ = _seed([(date(2026, 11, 20), 3, [("이상 없는 약", "E05")])])
    body = client.get(URL.format("me"), headers=device).json()
    assert body["message"] == "확인된 주의사항은 없어요. 궁금한 점은 의사나 약사에게 확인해 주세요."

    _, device, _, _ = _seed([])
    body = client.get(URL.format("me"), headers=device).json()
    assert (body["drug_count"], body["message"]) == (0, "지금 드시는 약이 없어요.")


def test_dur_warnings_uses_original_when_gemini_fails(client, mfds, monkeypatch):
    _clear_cache("C03")
    _, device, _, _ = _seed([(date(2026, 11, 20), 3, [("예시약 C", "C03")])])

    # 호출 실패(None)나 빈 문장("")이면 식약처 원문 뒤에 마무리 안내만 붙이고, 저장하지 않습니다.
    for result in [None, [""]]:
        monkeypatch.setattr(dur_warnings, "to_easy_messages", lambda warnings, result=result: result)
        warning = client.get(URL.format("me"), headers=device).json()["warnings"][0]
        assert warning["easy_message"] == f"{ELDERLY}. {CLOSING}"
        with SessionLocal() as db:
            assert "easy_messages" not in db.get(DrugInfo, "C03").dur_json

    # 저장하지 않았으므로 다음 조회 때 다시 만들어 씁니다.
    monkeypatch.setattr(dur_warnings, "to_easy_messages", lambda warnings: ["졸릴 수 있어요."])
    warning = client.get(URL.format("me"), headers=device).json()["warnings"][0]
    assert warning["easy_message"] == f"졸릴 수 있어요. {CLOSING}"


def test_dur_warnings_errors(client, mfds, monkeypatch):
    _clear_cache("A01")
    patient_id, device, owner, outsider = _seed([(date(2026, 11, 20), 3, [("예시약 A", "A01")])])
    for headers, path_id, status, code in [
        ({}, "me", 401, "UNAUTHORIZED"),
        ({"X-Device-Token": "unknown"}, "me", 401, "UNAUTHORIZED"),
        (outsider, patient_id, 403, "FORBIDDEN"),
        (device, patient_id, 403, "FORBIDDEN"),
        (owner, 2_147_483_647, 404, "PATIENT_NOT_FOUND"),
        (owner, "abc", 404, "PATIENT_NOT_FOUND"),
    ]:
        response = client.get(URL.format(path_id), headers=headers)
        assert response.status_code == status
        assert response.json()["code"] == code

    def unavailable(item_seqs):
        raise MfdsUnavailable("down")

    monkeypatch.setattr(dur_warnings, "fetch_dur_items", unavailable)
    response = client.get(URL.format("me"), headers=device)
    assert response.status_code == 503
    assert response.json() == {
        "code": "MFDS_UNAVAILABLE",
        "message": "지금 약 주의사항을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
    }


def _mfds_transport(monkeypatch, handler):
    monkeypatch.setattr(
        dur_lookup.httpx, "Client",
        lambda **kwargs: REAL_HTTPX_CLIENT(transport=httpx.MockTransport(handler), **kwargs),
    )


def _mfds_page(items, total, code="00"):
    return httpx.Response(200, json={
        "header": {"resultCode": code, "resultMsg": "NORMAL SERVICE."},
        "body": {"pageNo": 1, "totalCount": total, "items": items},
    })


def test_fetch_dur_items_reads_pages_and_keeps_needed_fields(monkeypatch):
    monkeypatch.setattr(get_settings(), "mfds_service_key", "key%2Bvalue")
    monkeypatch.setattr(dur_lookup, "PAGE_SIZE", 1)
    requests = []

    def handler(request: httpx.Request):
        requests.append(request)
        params = request.url.params
        operation = request.url.path.rsplit("/", 1)[1]
        first_page = params["pageNo"] == "1"
        assert (params["serviceKey"], params["type"], params["numOfRows"]) == ("key+value", "json", "1")
        if params["itemSeq"] == "B02":
            return _mfds_page([], 0)  # 식약처는 DUR 정보가 없는 품목에 00 + totalCount 0 을 줍니다.
        assert params["itemSeq"] == "A01"
        if operation == "getUsjntTabooInfoList03":
            return _mfds_page([{
                "TYPE_NAME": "병용금기", "ITEM_SEQ": "A01", "ITEM_NAME": "예시약 A",
                "MIXTURE_ITEM_SEQ": "B02" if first_page else "C03", "PROHBT_CONTENT": " 병용금기\n", "REMARK": None,
            }], total=2)
        if operation == "getOdsnAtentInfoList03":
            return _mfds_page({"item": {"ITEM_SEQ": "A01", "INGR_NAME": "클로르페니라민", "PROHBT_CONTENT": None}}, total=1)
        return _mfds_page({"item": [
            {"ITEM_SEQ": "A01", "EFFECT_NAME": "해열진통소염제", "SERS_NAME": ""} if first_page
            else {"ITEM_SEQ": "OTHER", "EFFECT_NAME": "다른 품목"},
        ]}, total=2)

    _mfds_transport(monkeypatch, handler)
    assert fetch_dur_items(["A01", "B02"]) == {
        "A01": [
            {"TYPE_NAME": "병용금기", "ITEM_SEQ": "A01", "MIXTURE_ITEM_SEQ": "B02", "PROHBT_CONTENT": "병용금기"},
            {"TYPE_NAME": "병용금기", "ITEM_SEQ": "A01", "MIXTURE_ITEM_SEQ": "C03", "PROHBT_CONTENT": "병용금기"},
            {"TYPE_NAME": "노인주의", "ITEM_SEQ": "A01", "INGR_NAME": "클로르페니라민"},
            {"TYPE_NAME": "효능군중복", "ITEM_SEQ": "A01", "EFFECT_NAME": "해열진통소염제"},
        ],
        "B02": [],
    }
    assert len(requests) == 8  # A01: 2 + 1 + 2 페이지, B02: 3종 1페이지씩


def test_fetch_dur_items_failures(monkeypatch):
    monkeypatch.setattr(get_settings(), "mfds_service_key", "")
    assert fetch_dur_items([]) == {}
    with pytest.raises(MfdsUnavailable):
        fetch_dur_items(["A01"])

    monkeypatch.setattr(get_settings(), "mfds_service_key", "key")
    _mfds_transport(monkeypatch, lambda request: _mfds_page([], 0, code="03"))
    assert fetch_dur_items(["A01"]) == {"A01": []}

    for handler in [
        lambda request: _mfds_page([], 0, code="30"),  # 등록되지 않은 인증키
        lambda request: httpx.Response(500),
        lambda request: httpx.Response(200, text="<xml/>"),
        lambda request: _mfds_page([], 5),  # totalCount 보다 적게 옴
        lambda request: _mfds_page([], 500 * 21),  # 품목·종류당 1만 건 초과
    ]:
        _mfds_transport(monkeypatch, handler)
        with pytest.raises(MfdsUnavailable):
            fetch_dur_items(["A01"])


def test_to_easy_messages_checks_each_sentence(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    sent = []
    inputs = [
        ("CONCOMITANT_CONTRAINDICATION", TABOO),
        ("ELDERLY_CAUTION", "기립성 저혈압, 비틀거림"),
        ("ELDERLY_CAUTION", "고용량 투여 시 주의"),
        ("ELDERLY_CAUTION", ELDERLY),
        ("DUPLICATE_EFFICACY", "효능군중복: 해열진통소염제"),
    ]
    replies = [
        " 함께 드시면 안 되는 약이에요. 의사나 약사에게 꼭 확인해 주세요. ",  # 마무리 문장은 서버가 붙이므로 지움
        "일어설 때 어지럽고 비틀거릴 수 있으니 약을 끊으셔야 해요.",  # 원문에 없는 복용 중단 지시
        "많은 양(고용량)을 드실 때 주의가 필요해요.",  # 원문에 있는 '용량' 은 괜찮음
        "   ",
        "약사와 상의하세요.",  # 마무리 문장뿐이라 비게 됨
    ]

    def post(url, **kwargs):
        sent.append(kwargs["json"])
        text = json.dumps({"easy_messages": replies})
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(dur_lookup.httpx, "post", post)
    assert to_easy_messages(inputs) == [
        "함께 드시면 안 되는 약이에요.",
        "",
        "많은 양(고용량)을 드실 때 주의가 필요해요.",
        "",
        "",
    ]
    assert sent[0]["generationConfig"]["temperature"] == 0.2
    assert json.loads(sent[0]["contents"][0]["parts"][0]["text"])[0] == {"type": "병용금기", "original_message": TABOO}
    # 개수가 맞지 않으면 쓰지 않습니다.
    assert to_easy_messages(inputs[:2]) is None
