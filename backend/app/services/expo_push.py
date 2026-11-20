from dataclasses import dataclass, field
from typing import Any

import httpx

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
MAX_BATCH_SIZE = 100


class ExpoPushError(RuntimeError):
    """Expo Push 서비스 호출 자체가 실패한 경우."""


@dataclass(frozen=True)
class ExpoPushResult:
    accepted: int = 0
    invalid_tokens: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def send_expo_push(
    tokens: list[str],
    *,
    title: str,
    body: str,
    data: dict[str, Any],
) -> ExpoPushResult:
    """보호자의 모든 Expo 토큰에 알림을 보내고 즉시 확인 가능한 오류를 반환합니다."""

    unique_tokens = list(dict.fromkeys(tokens))
    if not unique_tokens:
        return ExpoPushResult()

    accepted = 0
    invalid_tokens: list[str] = []
    errors: list[str] = []

    try:
        with httpx.Client(timeout=10.0) as client:
            for start in range(0, len(unique_tokens), MAX_BATCH_SIZE):
                batch = unique_tokens[start : start + MAX_BATCH_SIZE]
                messages = [
                    {
                        "to": token,
                        "title": title,
                        "body": body,
                        "sound": "default",
                        "priority": "high",
                        "data": data,
                    }
                    for token in batch
                ]
                response = client.post(
                    EXPO_PUSH_URL,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                    json=messages,
                )
                response.raise_for_status()
                payload = response.json()
                tickets = payload.get("data")
                if not isinstance(tickets, list) or len(tickets) != len(batch):
                    raise ExpoPushError("Expo Push 응답 형식이 올바르지 않습니다.")

                for token, ticket in zip(batch, tickets, strict=True):
                    if ticket.get("status") == "ok":
                        accepted += 1
                        continue
                    error_code = (ticket.get("details") or {}).get("error")
                    if error_code == "DeviceNotRegistered":
                        invalid_tokens.append(token)
                    errors.append(str(error_code or ticket.get("message") or "UNKNOWN"))
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise ExpoPushError("Expo Push 서비스에 연결할 수 없습니다.") from exc

    return ExpoPushResult(
        accepted=accepted,
        invalid_tokens=invalid_tokens,
        errors=errors,
    )
