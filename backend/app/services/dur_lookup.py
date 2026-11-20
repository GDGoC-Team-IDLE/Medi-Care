"""식약처 DUR 품목정보 조회와 쉬운 문장 변환 (약 주의사항 조회 API 에서 사용).

- 식약처: 품목기준코드(itemSeq)로 병용금기·노인주의·효능군중복을 받아 옵니다. 주의사항 판단은 이 데이터로만 합니다.
- Gemini: 식약처 원문을 어르신이 알아듣기 쉬운 문장으로 바꾸기만 합니다. 실패하거나 비면 식약처 원문을 그대로 씁니다.
  마무리 안내(app.dur.CLOSING)는 Gemini 가 아니라 서버가 붙입니다.
- 받은 결과는 drug_info.dur_json 에 {"items": [...], "easy_messages": {(경고 종류, 약, 상대 약): 문장}} 로 캐시합니다.
"""

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import unquote

import httpx

from app.core.config import get_settings
from app.dur import CONCOMITANT, DUPLICATE
from app.services.gemini import API_URL as GEMINI_URL

logger = logging.getLogger(__name__)

MFDS_URL = "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/{}"
# 오퍼레이션 → TYPE_NAME (app.dur.MFDS_TYPES 의 키)
OPERATIONS = {
    "getUsjntTabooInfoList03": "병용금기",
    "getOdsnAtentInfoList03": "노인주의",
    "getEfcyDplctInfoList03": "효능군중복",
}
PAGE_SIZE = 500
# 조회 조건이 무시되어 전체 목록을 받아 오는 일이 없도록 품목·종류당 1만 건까지만 받습니다.
MAX_PAGES = 20
MAX_WORKERS = 8  # 식약처에 동시에 보내는 요청 수
# 병용금기는 상대 품목마다 한 줄이라 수천 건이 될 수 있어, 경고 계산에 쓰는 값만 남깁니다.
KEPT_FIELDS = ("ITEM_SEQ", "MIXTURE_ITEM_SEQ", "PROHBT_CONTENT", "INGR_NAME", "EFFECT_NAME", "SERS_NAME")
TYPE_LABELS = {CONCOMITANT: "병용금기", "ELDERLY_CAUTION": "노인주의", DUPLICATE: "효능군중복"}
EASY_INSTRUCTION = (
    "입력 배열의 각 항목은 식약처 DUR 주의사항의 종류(type)와 원문(original_message)입니다. "
    "종류의 뜻: 병용금기는 함께 드시면 안 되는 약 조합, 노인주의는 어르신이 특히 주의해서 드셔야 하는 약, "
    "효능군중복은 비슷한 효과의 약이 겹친 경우입니다. "
    "종류의 뜻과 원문을 어르신이 읽기 쉬운 문장으로 바꾸고, 아래 규칙을 반드시 지키세요. "
    "1) 1~2문장으로 쓰고, 모든 문장은 '~요'로 끝나는 존댓말로 쓰세요. "
    "2) 어르신이 아는 쉬운 단어를 쓰세요. "
    "3) 원문에 있는 구체적인 증상과 위험(예: 어지러움, 입마름, 출혈)은 하나도 빼지 말고 그대로 넣으세요. "
    "어려운 용어는 쉬운 말로 풀어도 되지만 빼면 안 됩니다. "
    "4) 원문에 없는 내용은 절대 덧붙이지 마세요. 복용 중단, 용량 변경 같은 지시나 위험 정도 판단은 쓰지 마세요. "
    "5) '의사나 약사에게 확인해 주세요' 같은 마무리 문장은 쓰지 마세요. "
    "입력과 같은 순서, 같은 개수로 easy_messages 배열에 담으세요."
)
# Gemini 가 규칙과 달리 붙인 마무리 문장 (서버가 CLOSING 을 따로 붙이므로 지웁니다)
CLOSING_SENTENCE = re.compile(r"\s*[^.!?]*(의사|약사)[^.!?]*(확인|상의|문의)[^.!?]*[.!?]?\s*$")
# 원문에 없는데 문장에 있으면 복용 중단·용량 변경 지시를 덧붙인 것으로 보고 쓰지 않습니다.
INSTRUCTION_WORDS = ("중단", "끊", "그만 드", "용량", "양을 줄", "양을 늘", "줄여 드", "늘려 드")
EASY_SCHEMA = {
    "type": "object",
    "properties": {"easy_messages": {"type": "array", "items": {"type": "string"}}},
    "required": ["easy_messages"],
}


class MfdsUnavailable(RuntimeError):
    """식약처 DUR 서비스 호출이 실패했거나 응답이 올바르지 않은 경우."""


def _read_page(
    client: httpx.Client, service_key: str, operation: str, item_seq: str, page: int
) -> tuple[list[dict[str, Any]], int]:
    try:
        response = client.get(MFDS_URL.format(operation), params={
            "serviceKey": unquote(service_key),
            "type": "json",
            "pageNo": page,
            "numOfRows": PAGE_SIZE,
            "itemSeq": item_seq,
        })
        response.raise_for_status()
        payload = response.json()
        payload = payload.get("response", payload)
        code = str(payload["header"]["resultCode"]).strip()
        if code in {"03", "003"}:  # 해당 품목의 DUR 정보 없음
            return [], 0
        if code not in {"0", "00", "000"}:
            raise ValueError("MFDS returned an error")

        body = payload["body"]
        total = int(body["totalCount"])
        items = body.get("items") or []
        if isinstance(items, dict):
            items = items.get("item") or []
        if isinstance(items, dict):
            items = [items]
        if total < 0 or not isinstance(items, list) or not all(isinstance(row, dict) for row in items):
            raise ValueError("Invalid MFDS items")
        return items, total
    except (httpx.HTTPError, AttributeError, KeyError, TypeError, ValueError):
        # 요청 URL 에 인증키가 들어 있으므로 원래 예외를 이어 붙이지 않습니다.
        raise MfdsUnavailable("Could not read MFDS DUR information") from None


def fetch_dur_items(item_seqs: list[str]) -> dict[str, list[dict[str, str]]]:
    """품목들의 병용금기·노인주의·효능군중복 정보를 받아 품목별로 경고 계산에 필요한 값만 돌려줍니다.

    식약처 응답이 한 번에 0.5~3초씩 걸려, 모든 품목·종류의 첫 페이지를 동시에 받고 남은 페이지도 동시에 받습니다.
    """
    if not item_seqs:
        return {}
    service_key = get_settings().mfds_service_key
    if not service_key:
        raise MfdsUnavailable("MFDS_SERVICE_KEY 가 설정되지 않았습니다.")

    jobs = [(item_seq, operation) for item_seq in item_seqs for operation in OPERATIONS]
    with httpx.Client(timeout=10.0) as client, ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        def read(job: tuple[str, str], page: int) -> tuple[list[dict[str, Any]], int]:
            return _read_page(client, service_key, job[1], job[0], page)

        firsts = list(pool.map(read, jobs, [1] * len(jobs)))
        totals = {job: total for job, (_, total) in zip(jobs, firsts)}
        rest = [
            (job, page)
            for job, total in totals.items()
            for page in range(2, -(-total // PAGE_SIZE) + 1)
        ]
        if any(page > MAX_PAGES for _, page in rest):
            raise MfdsUnavailable("Too many MFDS DUR items")
        rest_pages = list(pool.map(read, [job for job, _ in rest], [page for _, page in rest]))

    received = {job: list(items) for job, (items, _) in zip(jobs, firsts)}
    for (job, _), (items, total) in zip(rest, rest_pages):
        if total != totals[job]:
            raise MfdsUnavailable("MFDS DUR item count changed between pages")
        received[job].extend(items)

    unique: dict[str, dict[tuple[tuple[str, str], ...], dict[str, str]]] = {seq: {} for seq in item_seqs}
    for (item_seq, operation), items in received.items():
        if len(items) < totals[(item_seq, operation)]:
            raise MfdsUnavailable("MFDS returned fewer DUR items than totalCount")
        for item in items:
            if str(item.get("ITEM_SEQ") or "").strip() != item_seq:
                continue
            row = {"TYPE_NAME": OPERATIONS[operation]}
            row.update(
                (field, str(item[field]).strip()) for field in KEPT_FIELDS if item.get(field) not in (None, "")
            )
            unique[item_seq].setdefault(tuple(sorted(row.items())), row)
    return {item_seq: list(rows.values()) for item_seq, rows in unique.items()}


def to_easy_messages(warnings: list[tuple[str, str]]) -> list[str] | None:
    """(종류, 식약처 원문) 목록을 같은 순서의 쉬운 문장 목록으로 바꿉니다.

    호출이 실패하면 None, 규칙에 맞지 않거나 빈 문장은 "" 입니다.

    어르신 이름이나 약 이름은 보내지 않고, 주의사항 종류와 원문만 보냅니다.
    """
    settings = get_settings()
    if not warnings or not settings.gemini_api_key:
        return None

    entries = [
        {"type": TYPE_LABELS.get(kind, kind), "original_message": original}
        for kind, original in warnings
    ]
    try:
        response = httpx.post(
            GEMINI_URL.format(model=settings.gemini_model),
            headers={"x-goog-api-key": settings.gemini_api_key},
            json={
                "systemInstruction": {"parts": [{"text": EASY_INSTRUCTION}]},
                "contents": [{"role": "user", "parts": [{"text": json.dumps(entries, ensure_ascii=False)}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                    "responseJsonSchema": EASY_SCHEMA,
                    "thinkingConfig": {"thinkingLevel": "MINIMAL"},
                },
            },
            timeout=10.0,
        )
        response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        messages = json.loads(text)["easy_messages"]
    except (httpx.HTTPError, AttributeError, IndexError, KeyError, TypeError, ValueError):
        logger.warning("Gemini DUR easy messages were unavailable")
        return None

    if not isinstance(messages, list) or len(messages) != len(warnings):
        logger.warning("Gemini DUR easy messages had an unexpected shape")
        return None
    return [_checked(message, original) for message, (_, original) in zip(messages, warnings)]


def _checked(message: object, original: str) -> str:
    """규칙에 맞으면 마무리 문장을 뺀 문장을, 쓸 수 없으면 "" 를 돌려줍니다 (호출한 쪽이 원문을 씁니다)."""
    if not isinstance(message, str):
        return ""
    text = CLOSING_SENTENCE.sub("", message.strip()).strip()
    if len(text) > 200 or any(word in text and word not in original for word in INSTRUCTION_WORDS):
        return ""
    return text
