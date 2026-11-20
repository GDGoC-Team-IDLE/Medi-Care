import logging

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.database import get_db
from app.core.envelope import ApiError
from app.routers.auth import bearer, get_guardian_auth
from app.routers.patients import get_device_patient
from app.services.gemini import GeminiUnavailableError
from app.services.photo_upload import read_photo
from app.services.prescription_photo import PrescriptionPreview, analyze_prescription_photo

logger = logging.getLogger(__name__)
device_header = APIKeyHeader(name="X-Device-Token", auto_error=False)
ERRORS = {
    400: ("IMAGE_REQUIRED", "사진을 첨부해 주세요."),
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    413: ("IMAGE_TOO_LARGE", "사진은 10MB 이하만 올릴 수 있어요."),
    415: ("UNSUPPORTED_IMAGE_TYPE", "jpg, png, webp 사진만 올릴 수 있어요."),
    503: ("AI_UNAVAILABLE", "지금 사진 분석을 할 수 없어요. 잠시 후 다시 시도해 주세요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}


def _error(status_code: int) -> JSONResponse:
    code, message = ERRORS[status_code]
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
        headers={"Cache-Control": "no-store"},
    )


class AnalysisRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError:
                return _error(400)
            except (ApiError, HTTPException) as exc:
                if exc.status_code in ERRORS:
                    return _error(exc.status_code)
                raise
            except GeminiUnavailableError:
                return _error(503)
            except Exception as exc:
                logger.error("Prescription preview failed: %s", type(exc).__name__)
                return _error(500)

        return handle


router = APIRouter(tags=["prescriptions"], route_class=AnalysisRoute)


class AnalysisError(BaseModel):
    code: str
    message: str


def _require_auth(
    device_token: str | None,
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> None:
    if device_token:
        try:
            get_device_patient(device_token, db)
            return
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
    get_guardian_auth(credentials, db)


@router.post(
    "/prescriptions/analyze",
    response_model=PrescriptionPreview,
    responses={code: {"model": AnalysisError} for code in ERRORS},
)
def analyze_prescription(
    response: Response,
    image: UploadFile = File(...),
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    _require_auth(device_token, credentials, db)
    db.close()
    photo, mime_type = read_photo(image, limit_mb=10)
    response.headers["Cache-Control"] = "no-store"
    return analyze_prescription_photo(photo, mime_type)
