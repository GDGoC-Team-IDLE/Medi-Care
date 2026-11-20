from datetime import date, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models import DrugInfo, DurCheck, Guardian, Patient, Prescription, PrescriptionDrug
from app.routers import dur_checks, dur_warnings
from app.security import create_access_token
from app.services.dur_lookup import MfdsUnavailable

URL = "/api/v1/patients/{}/dur/checks/"
ALL_TYPES = ["CONCOMITANT_CONTRAINDICATION", "ELDERLY_CAUTION", "DUPLICATE_EFFICACY"]
CLOSING = "의사나 약사에게 확인해 주세요."
TABOO = "병용금기 대상 성분 조합"
ELDERLY = "노인주의 대상 성분: 클로르페니라민"
DUPLICATE = "효능군중복: 해열진통소염제"

# 품목기준코드별 식약처 DUR 응답 (fetch_dur_items 가 돌려주는 모양)
MFDS = {
    "CK1": [
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "CK1", "MIXTURE_ITEM_SEQ": "CK2", "PROHBT_CONTENT": TABOO},
        {"TYPE_NAME": "효능군중복", "ITEM_SEQ": "CK1", "EFFECT_NAME": "해열진통소염제"},
    ],
    "CK2": [
        {"TYPE_NAME": "병용금기", "ITEM_SEQ": "CK2", "MIXTURE_ITEM_SEQ": "CK1", "PROHBT_CONTENT": TABOO},
    ],
    "CK3": [
        {"TYPE_NAME": "노인주의", "ITEM_SEQ": "CK3", "INGR_NAME": "클로르페니라민"},
        {"TYPE_NAME": "효능군중복", "ITEM_SEQ": "CK3", "EFFECT_NAME": "해열진통소염제"},
    ],
}


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def mfds(monkeypatch):
    monkeypatch.setattr(dur_checks, "now_local", lambda: datetime(2026, 11, 20, 14, 0, 0, 123))
    fetched: list[str] = []
    easy_requests: list[list[tuple[str, str]]] = []

    def fetch(item_seqs):
        fetched.extend(item_seqs)
        return {item_seq: MFDS[item_seq] for item_seq in item_seqs}

    def easy(warnings):
        easy_requests.append(warnings)
        return [f"쉬운 문장 {kind}이에요." for kind, _ in warnings]

    monkeypatch.setattr(dur_checks, "fetch_dur_items", fetch)
    monkeypatch.setattr(dur_warnings, "to_easy_messages", easy)
    with SessionLocal() as db:
        for item_seq in MFDS:
            if (info := db.get(DrugInfo, item_seq)) is not None:
                db.delete(info)
        db.commit()
    return fetched, easy_requests


def _seed(drugs_by_rx: list[list[tuple[str, str | None]]]):
    """[[(약 이름, 품목기준코드)]] 처방마다 어르신의 처방을 만들고 (어르신 ID, 처방 ID 들, 보호자 헤더, 다른 보호자 헤더)를 돌려줍니다."""
    with SessionLocal() as db:
        guardian, other = [
            Guardian(email=f"{uuid4().hex}@example.com", password_hash="unused", name="보호자")
            for _ in range(2)
        ]
        patient = Patient(guardian=guardian, name="김순자")
        db.add_all([patient, other])
        prescriptions = []
        for drugs in drugs_by_rx:
            prescription = Prescription(patient=patient, start_date=date(2026, 11, 15), days=14, ai_json={})
            prescriptions.append(prescription)
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
            [prescription.id for prescription in prescriptions],
            {"Authorization": f"Bearer {create_access_token(guardian.id)}"},
            {"Authorization": f"Bearer {create_access_token(other.id)}"},
        )


def _seed_default():
    # 내과(예시약 A, C) + 정형외과(예시약 B) 두 병원 처방
    return _seed([[("예시약 A", "CK1"), ("예시약 C", "CK3")], [("예시약 B", "CK2")]])


def test_dur_check_combines_hospitals_and_saves_result(client, mfds):
    fetched, easy_requests = mfds
    patient_id, rx_ids, owner, _ = _seed_default()

    response = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": rx_ids, "check_types": ALL_TYPES,
    })

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["patient_id"] == patient_id
    assert data["checked_at"] == "2026-11-20T14:00:00+09:00"
    assert data["check_status"] == "COMPLETED"
    assert data["medication_count"] == 3
    assert data["warning_count"] == 3
    assert data["warnings"] == [
        {
            "warning_id": 1,
            "warning_type": "CONCOMITANT_CONTRAINDICATION",
            "medications": ["예시약 A", "예시약 B"],
            "original_message": TABOO,
            "easy_message": f"쉬운 문장 CONCOMITANT_CONTRAINDICATION이에요. {CLOSING}",
            "source": "MFDS_DUR",
        },
        {
            "warning_id": 2,
            "warning_type": "ELDERLY_CAUTION",
            "medications": ["예시약 C"],
            "original_message": ELDERLY,
            "easy_message": f"쉬운 문장 ELDERLY_CAUTION이에요. {CLOSING}",
            "source": "MFDS_DUR",
        },
        {
            "warning_id": 3,
            "warning_type": "DUPLICATE_EFFICACY",
            "medications": ["예시약 A", "예시약 C"],
            "original_message": DUPLICATE,
            "easy_message": f"쉬운 문장 DUPLICATE_EFFICACY이에요. {CLOSING}",
            "source": "MFDS_DUR",
        },
    ]
    assert sorted(fetched) == ["CK1", "CK2", "CK3"]
    assert len(easy_requests) == 1

    with SessionLocal() as db:
        check = db.get(DurCheck, data["check_id"])
        assert check.patient_id == patient_id
        assert check.prescription_ids == rx_ids
        assert check.check_types == ALL_TYPES
        assert check.checked_at == datetime(2026, 11, 20, 14, 0, 0)
        assert check.warnings_json == data["warnings"]

    # 두 번째 검사는 식약처·Gemini 를 다시 부르지 않고 저장된 원본과 쉬운 문장을 씁니다.
    again = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": rx_ids, "check_types": ALL_TYPES,
    })
    assert again.status_code == 200
    assert again.json()["data"]["warnings"] == data["warnings"]
    assert again.json()["data"]["check_id"] != data["check_id"]
    assert sorted(fetched) == ["CK1", "CK2", "CK3"]
    assert len(easy_requests) == 1


def test_dur_check_only_requested_types_and_prescriptions(client, mfds):
    patient_id, rx_ids, owner, _ = _seed_default()

    response = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": [rx_ids[0], rx_ids[0]], "check_types": ["ELDERLY_CAUTION"],
    })

    assert response.status_code == 200
    data = response.json()["data"]
    # 정형외과 처방(예시약 B)은 빠지므로 병용금기도 없고, 요청한 노인주의만 담습니다.
    assert data["medication_count"] == 2
    assert [(w["warning_id"], w["warning_type"], w["medications"]) for w in data["warnings"]] == [
        (1, "ELDERLY_CAUTION", ["예시약 C"]),
    ]
    with SessionLocal() as db:
        assert db.get(DurCheck, data["check_id"]).prescription_ids == [rx_ids[0]]


def test_dur_check_uses_original_message_when_gemini_fails(client, mfds, monkeypatch):
    monkeypatch.setattr(dur_warnings, "to_easy_messages", lambda warnings: None)
    patient_id, rx_ids, owner, _ = _seed_default()

    response = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": rx_ids, "check_types": ["CONCOMITANT_CONTRAINDICATION"],
    })

    assert response.status_code == 200
    [warning] = response.json()["data"]["warnings"]
    assert warning["easy_message"] == f"{TABOO}. {CLOSING}"


@pytest.mark.parametrize("payload", [
    {"prescription_ids": [], "check_types": ALL_TYPES},
    {"prescription_ids": ["1"], "check_types": ALL_TYPES},
    {"prescription_ids": [0], "check_types": ALL_TYPES},
    {"prescription_ids": None, "check_types": ALL_TYPES},
    {"prescription_ids": [1], "check_types": []},
    {"prescription_ids": [1], "check_types": ["PREGNANCY_CONTRAINDICATION"]},
    {"prescription_ids": [1]},
])
def test_dur_check_invalid_request(client, mfds, payload):
    patient_id, _, owner, _ = _seed_default()

    response = client.post(URL.format(patient_id), headers=owner, json=payload)

    assert response.status_code == 400
    assert response.json() == {
        "success": False,
        "error": {"code": "INVALID_REQUEST", "message": "DUR 검사 요청 정보가 올바르지 않습니다."},
    }


def test_dur_check_requires_login(client, mfds):
    patient_id, rx_ids, _, _ = _seed_default()
    payload = {"prescription_ids": rx_ids, "check_types": ALL_TYPES}

    for headers in ({}, {"Authorization": "Bearer invalid"}):
        response = client.post(URL.format(patient_id), headers=headers, json=payload)
        assert response.status_code == 401
        assert response.json() == {
            "success": False,
            "error": {"code": "UNAUTHORIZED", "message": "로그인이 필요합니다."},
        }
    # 본문이 잘못돼도 로그인부터 확인합니다.
    assert client.post(URL.format(patient_id), json={}).status_code == 401


def test_dur_check_forbidden_for_other_guardian(client, mfds):
    patient_id, rx_ids, _, other = _seed_default()
    payload = {"prescription_ids": rx_ids, "check_types": ALL_TYPES}

    for target in (patient_id, 2_147_483_647):
        response = client.post(URL.format(target), headers=other, json=payload)
        assert response.status_code == 403
        assert response.json()["error"] == {
            "code": "FORBIDDEN", "message": "해당 복용자의 약물 정보를 조회할 권한이 없습니다.",
        }


def test_dur_check_prescription_not_found(client, mfds):
    fetched, _ = mfds
    patient_id, rx_ids, owner, _ = _seed_default()
    _, other_rx_ids, _, _ = _seed_default()

    for ids in ([rx_ids[0], 2_147_483_647], [rx_ids[0], other_rx_ids[0]]):
        response = client.post(URL.format(patient_id), headers=owner, json={
            "prescription_ids": ids, "check_types": ALL_TYPES,
        })
        assert response.status_code == 404
        assert response.json()["error"] == {
            "code": "PRESCRIPTION_NOT_FOUND", "message": "처방전 정보를 찾을 수 없습니다.",
        }
    assert fetched == []


def test_dur_check_unidentified_medication(client, mfds):
    fetched, _ = mfds
    patient_id, rx_ids, owner, _ = _seed([[("예시약 A", "CK1"), ("뮤테란캡슐100밀리그램", None)]])

    response = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": rx_ids, "check_types": ALL_TYPES,
    })

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "MEDICATION_UNIDENTIFIED",
        "message": "일부 약물의 성분을 확인할 수 없어 DUR 검사를 진행할 수 없습니다.",
    }
    assert fetched == []


def test_dur_check_mfds_unavailable(client, mfds, monkeypatch):
    def unavailable(item_seqs):
        raise MfdsUnavailable("down")

    monkeypatch.setattr(dur_checks, "fetch_dur_items", unavailable)
    patient_id, rx_ids, owner, _ = _seed_default()

    response = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": rx_ids, "check_types": ALL_TYPES,
    })

    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "DUR_SERVICE_UNAVAILABLE",
        "message": "의약품 주의사항을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    }
    with SessionLocal() as db:
        assert db.query(DurCheck).filter_by(patient_id=patient_id).count() == 0


def test_dur_check_internal_error(client, mfds, monkeypatch):
    def broken(drugs):
        raise RuntimeError("boom")

    monkeypatch.setattr(dur_checks, "dur_warnings_with_seqs", broken)
    patient_id, rx_ids, owner, _ = _seed_default()

    response = client.post(URL.format(patient_id), headers=owner, json={
        "prescription_ids": rx_ids, "check_types": ALL_TYPES,
    })

    assert response.status_code == 500
    assert response.json() == {
        "success": False,
        "error": {"code": "INTERNAL_SERVER_ERROR", "message": "DUR 검사 중 오류가 발생했습니다."},
    }
