"""Gemini API 호출: 이미지 1장 + 지시문 → JSON 객체.

복약 인증 사진 분석에서 쓰고, 처방전 사진 분석 등 다른 기능에서도 같이 쓸 수 있습니다.
"""

import base64
import json
import logging
from typing import Any

import httpx2

from app.core.config import get_settings

logger = logging.getLogger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiUnavailableError(Exception):
    """키 미설정, 네트워크 오류, 오류 응답 등으로 분석 결과를 받지 못함"""


def generate_json(*, image: bytes, mime_type: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
    """이미지와 지시문을 보내고, schema(JSON Schema) 모양의 JSON 객체를 돌려받습니다."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiUnavailableError("GEMINI_API_KEY 가 설정되지 않았습니다.")

    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(image).decode("ascii")}},
                    {"text": prompt},
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }
    try:
        res = httpx2.post(
            API_URL.format(model=settings.gemini_model),
            json=body,
            headers={"x-goog-api-key": settings.gemini_api_key},
            timeout=settings.gemini_timeout_seconds,
        )
    except httpx2.HTTPError as exc:
        raise GeminiUnavailableError(f"Gemini 호출 실패: {type(exc).__name__}") from exc

    if res.status_code != 200:
        logger.warning("Gemini 오류 응답 %s: %s", res.status_code, res.text[:500])
        raise GeminiUnavailableError(f"Gemini 오류 응답 ({res.status_code})")

    try:
        candidate = res.json()["candidates"][0]
        parts = candidate["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        result = json.loads(text)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("Gemini 응답을 해석하지 못했습니다: %s", res.text[:500])
        raise GeminiUnavailableError("Gemini 응답을 해석하지 못했습니다.") from exc

    if not isinstance(result, dict):
        raise GeminiUnavailableError("Gemini 응답이 JSON 객체가 아닙니다.")
    return result
