import logging
from dataclasses import dataclass
from typing import Any
from unicodedata import normalize
from urllib.parse import unquote

import httpx
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.models import DrugInfo, PrescriptionDrug

logger = logging.getLogger(__name__)
MFDS_BASE = "https://apis.data.go.kr/1471000"
PILL_LOOKUP = f"{MFDS_BASE}/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03"
DUR_BASE = f"{MFDS_BASE}/DURPrdlstInfoService03"
DUR_LOOKUP = "getDurPrdlstInfoList03"
DUR_DETAILS = {
    "특정연령대금기": "getSpcifyAgrdeTabooInfoList03",
    "임부금기": "getPwnmTabooInfoList03",
    "노인주의": "getOdsnAtentInfoList03",
    "용량주의": "getCpctyAtentInfoList03",
    "투여기간주의": "getMdctnPdAtentInfoList03",
    "서방정분할주의": "getSeobangjeongPartitnAtentInfoList03",
    "효능군중복": "getEfcyDplctInfoList03",
}


@dataclass(frozen=True)
class CatalogItem:
    seq: str
    name: str
    pill: dict[str, Any] | None
    dur: list[dict[str, Any]] | None


def _name_key(name: str) -> str:
    return " ".join(normalize("NFC", name).split()).casefold()


def _seq(row: dict[str, Any]) -> str:
    value = row.get("ITEM_SEQ")
    return str(value).strip() if isinstance(value, (str, int)) and not isinstance(value, bool) else ""


def _read_items(client: httpx.Client, url: str, **filters: str) -> list[dict[str, Any]] | None:
    rows: list[dict[str, Any]] = []
    expected_total = None
    page = 1
    try:
        while True:
            response = client.get(url, params={**filters, "pageNo": page})
            response.raise_for_status()
            payload = response.json()
            payload = payload.get("response", payload)
            code = str(payload["header"]["resultCode"]).strip()
            if code in {"03", "003"} and page == 1:
                return []
            if code not in {"0", "00", "000", "0000"}:
                raise ValueError("MFDS service error")

            body = payload["body"]
            total = int(body["totalCount"])
            if total < 0 or (expected_total is not None and total != expected_total):
                raise ValueError("Inconsistent MFDS result count")
            expected_total = total
            items = body.get("items")
            if isinstance(items, dict) and "item" in items:
                items = items["item"]
            if not items and total == 0:
                return []
            if isinstance(items, dict):
                items = [items]
            if not isinstance(items, list) or not items or not all(isinstance(row, dict) for row in items):
                raise ValueError("Invalid MFDS items")
            rows.extend(items)
            if len(rows) == total:
                return rows
            if len(rows) > total:
                raise ValueError("Unexpected MFDS items")
            page += 1
    except (httpx.HTTPError, AttributeError, KeyError, TypeError, ValueError):
        # URL에 인증키가 포함되므로 제공자 응답/예외 원문은 로그에서 제외합니다.
        logger.warning("Could not read MFDS catalog data")
        return None


def _exact_name(rows: list[dict[str, Any]] | None, name: str) -> list[dict[str, Any]]:
    key = _name_key(name)
    return [
        row for row in rows or []
        if isinstance(row.get("ITEM_NAME"), str) and _name_key(row["ITEM_NAME"]) == key
    ]


def _dur_records(
    client: httpx.Client, seq: str, general: list[dict[str, Any]] | None
) -> list[dict[str, Any]] | None:
    if general is None:
        return None
    records = [row for row in general if _seq(row) == seq]
    warning_types = {
        str(row.get("TYPE_NAME", "")).replace(" ", "") for row in records
    }
    operations = {"병용금기": "getUsjntTabooInfoList03"}
    operations.update({kind: DUR_DETAILS[kind] for kind in sorted(warning_types & DUR_DETAILS.keys())})
    for kind, operation in operations.items():
        details = _read_items(client, f"{DUR_BASE}/{operation}", itemSeq=seq)
        if details is None:
            return None
        records.extend(
            {**row, "TYPE_NAME": row.get("TYPE_NAME") or kind}
            for row in details if _seq(row) == seq
        )
    return records


def _lookup(client: httpx.Client, name: str) -> CatalogItem | None:
    pills = _exact_name(_read_items(client, PILL_LOOKUP, item_name=name), name)
    general = None
    if not pills:
        general = _read_items(client, f"{DUR_BASE}/{DUR_LOOKUP}", itemName=name)
    matches = pills or _exact_name(general, name)
    sequences = {_seq(row) for row in matches}
    if len(sequences) != 1:
        return None
    seq = sequences.pop()
    if not seq or len(seq) > 20:
        return None
    if pills:
        general = _read_items(client, f"{DUR_BASE}/{DUR_LOOKUP}", itemSeq=seq)
    # 같은 품목코드라도 낱알 원본이 여러 종류이면 모양을 임의로 고르지 않습니다.
    pill = pills[0] if pills and all(row == pills[0] for row in pills) else None
    return CatalogItem(seq, matches[0]["ITEM_NAME"].strip(), pill, _dur_records(client, seq, general))


def cache_prescription_drugs(
    db: Session, drugs: list[tuple[int, str]], service_key: str
) -> dict[int, str]:
    """처방 저장이 끝난 뒤 품목 캐시를 보강하고 확정된 약 ID를 반환합니다."""
    if not service_key:
        return {}

    lookups: dict[str, CatalogItem | None] = {}
    with httpx.Client(
        timeout=5.0, params={"serviceKey": unquote(service_key), "type": "json", "numOfRows": 100}
    ) as client:
        for _, name in drugs:
            key = _name_key(name)
            if key not in lookups:
                lookups[key] = _lookup(client, name)

    items = {item.seq: item for item in lookups.values() if item is not None}
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else postgres_insert
    fetched_at = now_local()
    for seq, item in sorted(items.items()):
        statement = insert(DrugInfo).values(
            item_seq=seq, item_name=item.name, normalized_name=_name_key(item.name),
            pill_json=item.pill or {}, dur_json=item.dur if item.dur is not None else {},
            fetched_at=fetched_at,
        )
        changes = {"fetched_at": statement.excluded.fetched_at}
        if item.pill is not None:
            changes["pill_json"] = statement.excluded.pill_json
        if item.dur is not None:
            changes["dur_json"] = statement.excluded.dur_json
        db.execute(statement.on_conflict_do_update(index_elements=[DrugInfo.item_seq], set_=changes))

    linked = {}
    for drug_id, name in drugs:
        item = lookups[_name_key(name)]
        if item is not None:
            matched_id = db.execute(
                update(PrescriptionDrug)
                .where(PrescriptionDrug.id == drug_id, PrescriptionDrug.item_seq.is_(None))
                .values(item_seq=item.seq)
                .returning(PrescriptionDrug.id)
            ).scalar_one_or_none()
            if matched_id is not None:
                linked[drug_id] = item.seq
    db.commit()
    return linked
