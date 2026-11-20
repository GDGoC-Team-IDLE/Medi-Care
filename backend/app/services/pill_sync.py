from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from unicodedata import normalize
from urllib.parse import unquote

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, joinedload

from app.core.clock import now_local
from app.models import DrugInfo, PrescriptionDrug
from app.services.pill_appearance import appearance_from_mfds, imprint_from_mfds

MFDS_URL = "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03"
PAGE_SIZE = 100
LookupStatus = Literal["MATCHED", "NOT_FOUND", "AMBIGUOUS"]


class MfdsUnavailable(RuntimeError):
    """낱알식별 서비스 호출이 실패했거나 응답이 올바르지 않은 경우."""


@dataclass(frozen=True)
class MedicationAppearance:
    medication_id: int
    medication_name: str
    color: str | None
    shape: str | None
    imprint: str | None
    lookup_status: LookupStatus


def _normalize_name(name: str) -> str:
    return " ".join(normalize("NFC", name).split()).casefold()


def _item_seq(record: dict[str, Any]) -> str:
    value = record.get("ITEM_SEQ")
    return str(value).strip() if isinstance(value, (str, int)) and not isinstance(value, bool) else ""


def _read_page(
    client: httpx.Client, service_key: str, field: str, value: str, page: int
) -> tuple[list[dict[str, Any]], int]:
    if not service_key:
        raise MfdsUnavailable("Missing MFDS service key")

    try:
        response = client.get(MFDS_URL, params={
            "serviceKey": unquote(service_key),
            "type": "json",
            "pageNo": page,
            "numOfRows": PAGE_SIZE,
            field: value,
        })
        response.raise_for_status()
        payload = response.json()
        payload = payload.get("response", payload)
        code = str(payload["header"]["resultCode"]).strip()
        if code in {"03", "003"}:
            return [], 0
        if code not in {"0", "00", "000"}:
            raise MfdsUnavailable("MFDS returned an error")

        body = payload["body"]
        total = int(body["totalCount"])
        if total < 0:
            raise ValueError("Invalid MFDS item count")
        items = body.get("items")
        if isinstance(items, dict) and "item" in items:
            items = items["item"]
        if isinstance(items, dict):
            items = [items]
        if total == 0:
            if items:
                raise ValueError("Unexpected MFDS items")
            return [], 0
        if not isinstance(items, list) or not items or not all(isinstance(row, dict) for row in items):
            raise ValueError("Invalid MFDS items")
        return items, total
    except (httpx.HTTPError, AttributeError, KeyError, TypeError, ValueError):
        # 요청 URL에 인증키가 포함되므로 상위 로그로 전달하지 않습니다.
        raise MfdsUnavailable("Could not read MFDS pill information") from None


def _lookup(
    client: httpx.Client, service_key: str, field: str, value: str
) -> tuple[dict[str, Any] | None, LookupStatus]:
    match = None
    received = 0
    page = 1
    expected_total = None
    while True:
        items, total = _read_page(client, service_key, field, value, page)
        if expected_total is not None and expected_total != total:
            raise MfdsUnavailable("MFDS result count changed between pages")
        expected_total = total
        for item in items:
            name = item.get("ITEM_NAME")
            seq = _item_seq(item)
            if field == "item_seq":
                exact = seq == value
            else:
                exact = isinstance(name, str) and _normalize_name(name) == _normalize_name(value)
            if not exact:
                continue
            if not seq or len(seq) > 20 or not isinstance(name, str) or not name.strip():
                return None, "AMBIGUOUS"
            if match is not None and match != item:
                return None, "AMBIGUOUS"
            match = item
        received += len(items)
        if received >= total:
            return (match, "MATCHED") if match is not None else (None, "NOT_FOUND")
        page += 1


def _store_pill(db: Session, item_seq: str, item_name: str, record: dict[str, Any], now: datetime) -> None:
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else postgres_insert
    statement = insert(DrugInfo).values(
        item_seq=item_seq,
        item_name=item_name,
        normalized_name=_normalize_name(item_name),
        pill_json=record,
        dur_json={},
        fetched_at=now,
    )
    db.execute(statement.on_conflict_do_update(
        index_elements=[DrugInfo.item_seq],
        set_={"pill_json": statement.excluded.pill_json, "fetched_at": statement.excluded.fetched_at},
    ))


def sync_pill_appearances(
    db: Session, prescription_id: int, *, refresh: bool, service_key: str
) -> list[MedicationAppearance]:
    drugs = db.scalars(
        select(PrescriptionDrug)
        .where(PrescriptionDrug.prescription_id == prescription_id)
        .options(joinedload(PrescriptionDrug.drug_info))
        .order_by(PrescriptionDrug.id)
    ).all()
    lookups: dict[tuple[str, str], tuple[dict[str, Any] | None, LookupStatus]] = {}
    updates: dict[str, tuple[str, dict[str, Any]]] = {}
    links: list[tuple[PrescriptionDrug, str]] = []
    results = []
    with httpx.Client(timeout=5.0) as client:
        for drug in drugs:
            cache = drug.drug_info
            raw = cache.pill_json if cache else None
            look = appearance_from_mfds(raw)
            status: LookupStatus = "MATCHED"
            if refresh or look is None:
                key = ("item_seq", drug.item_seq) if drug.item_seq else ("item_name", drug.drug_name.strip())
                if key not in lookups:
                    lookups[key] = _lookup(client, service_key, *key) if key[1] else (None, "NOT_FOUND")
                raw, status = lookups[key]
                look = appearance_from_mfds(raw)
                if raw is not None and (look is not None or cache is not None):
                    seq = _item_seq(raw)
                    updates[seq] = (raw["ITEM_NAME"].strip(), raw)
                    links.append((drug, seq))
                elif cache is not None and refresh:
                    # 품목 연결과 DUR은 보존하고 더 이상 확인되지 않는 외형만 비웁니다.
                    updates[cache.item_seq] = (cache.item_name, {})
                if status == "MATCHED" and look is None:
                    status = "NOT_FOUND"
            results.append(MedicationAppearance(
                medication_id=drug.id,
                medication_name=drug.drug_name,
                color=look.color_name if look else None,
                shape=look.shape if look else None,
                imprint=imprint_from_mfds(raw) if look else None,
                lookup_status=status,
            ))
    # 외부 조회를 끝낸 뒤 키 순서대로 저장해 여러 처방의 동시 동기화에도 쓰기 순서를 통일합니다.
    fetched_at = now_local()
    for seq, (name, record) in sorted(updates.items()):
        _store_pill(db, seq, name, record, fetched_at)
    for drug, seq in links:
        drug.item_seq = seq
    return results
