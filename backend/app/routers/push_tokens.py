import logging

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.database import get_db
from app.models import PushToken
from app.routers.auth import get_guardian_id

logger = logging.getLogger(__name__)
ERRORS = {
    400: ("INVALID_PUSH_TOKEN", "알림 토큰 형식이 올바르지 않아요."),
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}


def _error(status_code: int) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        {"code": code, "message": message},
        status_code=status_code,
        headers={"WWW-Authenticate": "Bearer"} if status_code == 401 else None,
    )


class PushTokenRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError:
                return _error(400)
            except HTTPException as exc:
                if exc.status_code in ERRORS:
                    return _error(exc.status_code)
                raise
            except Exception as exc:
                logger.error("Push token registration failed: %s", type(exc).__name__)
                return _error(500)

        return handle


router = APIRouter(tags=["notifications"], route_class=PushTokenRoute)


class PushTokenRequest(BaseModel):
    expo_token: str = Field(strict=True, max_length=255, pattern=r"^ExponentPushToken\[[A-Za-z0-9_-]+\]$")


class PushTokenResponse(BaseModel):
    push_token_id: int
    expo_token: str
    message: str


class PushTokenError(BaseModel):
    code: str
    message: str


@router.post(
    "/push-tokens",
    response_model=PushTokenResponse,
    responses={code: {"model": PushTokenError} for code in ERRORS},
)
def register_push_token(
    data: PushTokenRequest,
    guardian_id: int = Depends(get_guardian_id),
    db: Session = Depends(get_db),
):
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else postgresql_insert
    # 저장과 소유자 이전을 하나의 쿼리로 처리해 동시 등록에도 ID를 유지합니다.
    statement = insert(PushToken).values(expo_token=data.expo_token, guardian_id=guardian_id)
    push_token_id = db.execute(
        statement.on_conflict_do_update(
            index_elements=[PushToken.expo_token],
            set_={"guardian_id": statement.excluded.guardian_id},
        ).returning(PushToken.id)
    ).scalar_one()
    db.commit()
    return PushTokenResponse(
        push_token_id=push_token_id,
        expo_token=data.expo_token,
        message="알림 받을 준비가 됐어요.",
    )
