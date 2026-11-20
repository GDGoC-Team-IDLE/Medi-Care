"""{"success": true, "data": ...} / {"success": false, "error": {"code", "message"}} 형식 응답.

라우터에 route_class 로 EnvelopeRoute(또는 메시지만 바꾼 하위 클래스)를 주면
그 라우터의 에러만 이 형식으로 바뀌고, 다른 라우터의 응답 형식은 그대로입니다.

- ApiError(status_code, code, message) → 그 상태 코드
- 요청 형식 오류 (필수 값 누락, 경로 값 타입 오류 등) → 400 INVALID_REQUEST
- HTTPException → FastAPI 기본 처리 그대로
- 그 밖의 예외 → 500 INTERNAL_SERVER_ERROR (서버 로그에 남김)
"""

import logging
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def success(data: dict[str, Any]) -> dict[str, Any]:
    return {"success": True, "data": data}


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": {"code": code, "message": message}},
    )


class EnvelopeRoute(APIRoute):
    invalid_request_message = "요청 정보가 올바르지 않습니다."
    internal_error_message = "요청 처리 중 오류가 발생했습니다."

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def envelope_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except ApiError as exc:
                return error_response(exc.status_code, exc.code, exc.message)
            except RequestValidationError:
                return error_response(400, "INVALID_REQUEST", self.invalid_request_message)
            except HTTPException:
                raise
            except Exception:
                logger.exception("처리하지 못한 오류: %s %s", request.method, request.url.path)
                return error_response(500, "INTERNAL_SERVER_ERROR", self.internal_error_message)

        return envelope_handler
