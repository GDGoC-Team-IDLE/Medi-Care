import json
import logging
from collections import Counter
from dataclasses import asdict
from urllib.request import Request, urlopen

from app.core.config import get_settings
from app.dose_report import Adherence, MissedSummary, WrongRecord
from app.enums import Slot

logger = logging.getLogger(__name__)
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
SLOT_NAMES = {
    Slot.MORNING: "아침",
    Slot.LUNCH: "점심",
    Slot.DINNER: "저녁",
    Slot.BEDTIME: "취침 전",
}


def _report_text(days: int, adherence: Adherence, missed: MissedSummary, wrong_count: int) -> str:
    if adherence.total:
        text = (
            f"최근 {days}일 동안 집계된 {adherence.total}회 중 {adherence.done}회가 "
            f"인증 완료됐어요. 복약 인증률은 {adherence.adherence_rate:g}%예요."
        )
    else:
        text = f"최근 {days}일 동안 집계된 복약 회차가 없어요."
    if missed.most_missed_slot is not None:
        text += f"미복용 기록이 가장 많은 시간대는 {SLOT_NAMES[missed.most_missed_slot]}({missed.missed_count}회)이에요."
    if wrong_count:
        text += f"오복용 인증 기록은 {wrong_count}회예요."
    return text


def summarize_report(
    days: int, adherence: Adherence, missed: MissedSummary, wrong_records: list[WrongRecord]
) -> str:
    fallback = _report_text(days, adherence, missed, len(wrong_records))
    api_key = get_settings().gemini_api_key
    if not api_key or not (adherence.total or wrong_records):
        return fallback

    # 이름, 식별자, 약 이름, 인증 시각 등은 전송하지 않습니다.
    statistics = {
        "days": days,
        "adherence": asdict(adherence),
        "missed_summary": asdict(missed),
        "verification_result_counts": Counter(record.result for record in wrong_records),
    }
    instruction = (
        "입력 JSON의 복약 인증 집계와 미복용 및 오복용 인증 건수만 쉬운 한국어 2~3문장으로 요약하세요. "
        "수치와 사실을 그대로 옮기고 실제 복용 여부는 추정하지 마세요. "
        "의학적 진단, 위험 판단, 원인 추정, 약 변경 또는 복용 지시는 모두 금지합니다. "
        "MORNING은 아침, LUNCH는 점심, DINNER는 저녁, BEDTIME은 취침 전입니다. "
        "마크다운 없이 요약 문장만 출력하세요."
    )
    request = Request(
        GEMINI_URL,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        data=json.dumps({
            "systemInstruction": {"parts": [{"text": instruction}]},
            "contents": [{"parts": [{"text": json.dumps(statistics)}]}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 512,
                "thinkingConfig": {"thinkingLevel": "MINIMAL"},
            },
        }).encode("utf-8"),
        method="POST",
    )
    try:
        with urlopen(request, timeout=6) as response:
            result = json.load(response)
        candidate = result["candidates"][0]
        if candidate.get("finishReason") == "STOP":
            text = " ".join(
                part.get("text", "")
                for part in candidate["content"]["parts"]
                if not part.get("thought")
            ).strip()
            if text:
                return text
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError):
        logger.warning("Gemini report summary was unavailable")
    return fallback
