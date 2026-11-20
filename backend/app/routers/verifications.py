"""복약 인증: 복용자가 뜯은 약봉투와 꺼낸 알약을 사진 1장으로 찍어 회차 복용을 인증합니다.

    POST /api/v1/patients/{patient_id}/dose-slots/{slot_id}/verifications   (multipart, 필드 image)

인증: 어르신 폰은 X-Device-Token + patient_id=me, 보호자 앱은 Authorization: Bearer <JWT> + 어르신 ID.
응답: 사진 처리가 끝나면 판정과 관계없이 200 이고 화면은 result 로 나눕니다. 에러는 {"code", "message"}.

판정 순서 (앞에서 걸리면 거기서 끝)
1. 이미 DONE 인 회차      → ALREADY_TAKEN  (사진 분석 안 함, DONE 유지, 보호자 알림)
2. 사진을 못 읽음          → RETAKE         (회차 그대로, 기록 안 남김)
3. 봉투 시간 ≠ 회차        → WRONG_TIME     (회차 WRONG, 보호자 알림)
4. 알약 수 ≠ 회차 예상 개수 → COUNT_MISMATCH (회차 WRONG, 보호자 알림)
5. 그 밖                  → OK             (회차 DONE)

AI(Gemini)는 사진에서 특징만 뽑고, 위 판정은 모두 서버가 합니다.
알약 색·모양 대조는 판정을 바꾸지 않고, OK 일 때 appearance_check 에 경고로만 담습니다.
WRONG 회차는 다시 인증할 수 있고, RETAKE 를 뺀 시도는 사진과 결과를 dose_logs 에 한 줄씩 남깁니다.
"""

import logging
import re
import secrets
from collections.abc import Callable, Coroutine
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import SessionLocal, get_db
from app.core.envelope import ApiError
from app.core.photo_storage import sign_dose_photos
from app.enums import AppearanceStatus, DoseStatus, GuardianAlertType, Slot, VerifyResult
from app.models import DoseLog, DoseSlot, GuardianAlert, Patient, PushToken
from app.routers.auth import get_guardian_auth
from app.security import token_hash
from app.services.dose_photo import PhotoAnalysis, analyze_dose_photo
from app.services.expo_push import ExpoPushError, send_expo_push
from app.services.gemini import GeminiUnavailableError
from app.services.photo_storage import save_photo
from app.services.pill_appearance import AppearanceCheck, ExpectedPill, appearance_from_mfds, compare

logger = logging.getLogger(__name__)

ERRORS = {
    "IMAGE_REQUIRED": (400, "사진을 첨부해 주세요."),
    "UNAUTHORIZED": (401, "로그인 정보가 없어요. 다시 로그인해 주세요."),
    "FORBIDDEN": (403, "이 복용 회차를 인증할 수 없어요."),
    "DOSE_SLOT_NOT_FOUND": (404, "복용 회차를 찾을 수 없어요."),
    "SLOT_NOT_TODAY": (409, "오늘 약만 인증할 수 있어요."),
    "UNSUPPORTED_IMAGE_TYPE": (415, "jpg, png, webp 사진만 올릴 수 있어요."),
    "AI_UNAVAILABLE": (503, "지금 사진 확인을 할 수 없어요. 잠시 후 다시 시도해 주세요."),
    "INTERNAL_ERROR": (500, "일시적인 오류가 발생했어요."),
}


def _error(code: str) -> ApiError:
    status_code, message = ERRORS[code]
    return ApiError(status_code, code, message)


def _error_response(exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})


class VerificationRoute(APIRoute):
    """이 라우터의 에러를 {"code", "message"} 형식으로 돌려줍니다."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def verification_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except ApiError as exc:
                return _error_response(exc)
            except RequestValidationError as exc:
                # slot_id 가 숫자가 아니면 404, 그 밖(사진 필드가 없거나 파일이 아님)은 400
                in_path = any(err.get("loc", ("",))[0] == "path" for err in exc.errors())
                return _error_response(_error("DOSE_SLOT_NOT_FOUND" if in_path else "IMAGE_REQUIRED"))
            except HTTPException:
                raise
            except Exception:
                logger.exception("복약 인증 처리 중 오류: %s %s", request.method, request.url.path)
                return _error_response(_error("INTERNAL_ERROR"))

        return verification_handler


router = APIRouter(tags=["verifications"], route_class=VerificationRoute)
bearer = HTTPBearer(auto_error=False)

MAX_ID = 2_147_483_647
PHOTO_URL_SECONDS = 600
SLOT_LABELS = {Slot.MORNING: "아침", Slot.LUNCH: "점심", Slot.DINNER: "저녁", Slot.BEDTIME: "자기 전"}
PHOTO_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

RETAKE_MESSAGE = "사진을 정확하게 확인하기 어려워요. 약봉투와 알약이 잘 보이게 다시 찍어 주세요."
MISMATCH_MESSAGE = (
    "인증은 됐어요. 다만 알약 색이나 모양이 등록된 약과 달라 보여요. 약봉투를 한 번 더 확인해 주세요."
)
WRONG_RESULTS = (VerifyResult.WRONG_TIME, VerifyResult.COUNT_MISMATCH)
ALERT_RESULTS = (VerifyResult.ALREADY_TAKEN, *WRONG_RESULTS)
WRONG_DOSE_TITLE = "복약 확인이 필요해요"

PhotoAnalyzer = Callable[[bytes, str], PhotoAnalysis]


def get_photo_analyzer() -> PhotoAnalyzer:
    """사진 분석 함수. 테스트에서는 app.dependency_overrides 로 가짜 분석기로 바꿉니다."""
    return analyze_dose_photo


def get_target_patient(
    patient_id: str,
    x_device_token: str | None = Header(default=None, alias="X-Device-Token"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Patient:
    """인증할 어르신을 찾습니다. 어르신 폰은 기기 토큰 + me(또는 자기 ID), 보호자 앱은 JWT + 연결된 어르신 ID."""
    device_patient = None
    if x_device_token:
        device_patient = db.scalar(select(Patient).where(Patient.device_token == token_hash(x_device_token)))
        if device_patient is not None and patient_id in ("me", str(device_patient.id)):
            return device_patient

    guardian_id = None
    if credentials is not None:
        try:
            guardian_id = get_guardian_auth(credentials, db).guardian_id
        except HTTPException:
            pass
    if guardian_id is None:
        raise _error("UNAUTHORIZED" if device_patient is None else "FORBIDDEN")

    patient = None
    if re.fullmatch(r"[0-9]{1,10}", patient_id) and 1 <= int(patient_id) <= MAX_ID:
        patient = db.get(Patient, int(patient_id))
    if patient is None or patient.guardian_id != guardian_id:
        raise _error("FORBIDDEN")
    return patient


def _sniff_image_type(data: bytes) -> str | None:
    """파일 앞부분으로 이미지 형식을 알아냅니다 (앱이 보내는 Content-Type 은 믿지 않음)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _read_photo(photo: UploadFile) -> tuple[bytes, str]:
    limit_mb = get_settings().max_upload_mb
    data = photo.file.read(limit_mb * 1024 * 1024 + 1)
    if not data:
        raise _error("IMAGE_REQUIRED")
    if len(data) > limit_mb * 1024 * 1024:
        raise ApiError(413, "IMAGE_TOO_LARGE", f"사진은 {limit_mb}MB 이하만 올릴 수 있어요.")
    mime_type = _sniff_image_type(data)
    if mime_type is None:
        raise _error("UNSUPPORTED_IMAGE_TYPE")
    return data, mime_type


def _expected_pills(slot: DoseSlot) -> list[ExpectedPill]:
    """이 회차에 먹을 약을 알 단위로 펼칩니다. 식약처 정보가 없는 약은 look=None."""
    pills: list[ExpectedPill] = []
    for drug in slot.prescription.drugs:
        if str(slot.slot) not in (drug.slots or []) or not drug.is_scheduled_on(slot.slot_date):
            continue
        look = appearance_from_mfds(drug.drug_info.pill_json) if drug.drug_info else None
        pills.extend(ExpectedPill(drug.id, look) for _ in range(drug.count_per_dose))
    return pills


def _warnings(check: AppearanceCheck, drug_names: dict[int, str]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for gap in check.missing:
        look = gap.look
        if gap.seen == 0:
            message = f"{look.color_name} {look.shape} 알약이 사진에서 보이지 않아요."
        else:
            message = f"{look.color_name} {look.shape} 알약이 {gap.count}개 모자라 보여요."
        warnings.append(
            {
                "type": "MISSING_PILL",
                "drug_name": ", ".join(drug_names[d] for d in gap.drugs),
                "expected_color": look.color,
                "expected_shape": look.shape,
                "message": message,
            }
        )
    for gap in check.unexpected:
        count = f" {gap.count}개" if gap.count > 1 else ""
        warnings.append(
            {
                "type": "UNEXPECTED_PILL",
                "detected_color": gap.look.color,
                "detected_shape": gap.look.shape,
                "message": f"등록된 약과 다른 모양의 알약이{count} 보여요.",
            }
        )
    return warnings


def _appearance_check(slot: DoseSlot, analysis: PhotoAnalysis) -> dict[str, Any]:
    """등록된 약과 사진의 알약 색·모양을 대조합니다. 판정은 바꾸지 않고 경고만 만듭니다."""
    if analysis.looks_unclear:
        return {"status": AppearanceStatus.UNKNOWN.value, "warnings": []}
    check = compare(_expected_pills(slot), analysis.looks, slot.expected_count)
    drug_names = {drug.id: drug.drug_name for drug in slot.prescription.drugs}
    return {"status": check.status.value, "warnings": _warnings(check, drug_names)}


def _judge(slot: DoseSlot, analysis: PhotoAnalysis) -> tuple[VerifyResult, dict[str, Any] | None, str]:
    """사진 분석 결과를 회차 정보와 비교해 (판정, appearance_check, 안내 문구)를 정합니다."""
    if analysis.bag_time is None or analysis.pills_unclear:
        return VerifyResult.RETAKE, None, RETAKE_MESSAGE

    label = SLOT_LABELS[slot.slot]
    if analysis.bag_time != slot.slot:
        bag_label = SLOT_LABELS[analysis.bag_time]
        message = f"{label} 약을 인증하는 중이에요. 사진에는 {bag_label} 약봉투가 보여요. 약봉투를 다시 확인해 주세요."
        return VerifyResult.WRONG_TIME, None, message

    count = len(analysis.pills)
    if count != slot.expected_count:
        message = (
            f"사진에서 알약 {count}개가 보여요. 등록된 개수는 {slot.expected_count}개예요. "
            "약봉투 안을 다시 확인해 주세요."
        )
        return VerifyResult.COUNT_MISMATCH, None, message

    appearance = _appearance_check(slot, analysis)
    if appearance["status"] == AppearanceStatus.MISMATCH:
        return VerifyResult.OK, appearance, MISMATCH_MESSAGE
    return VerifyResult.OK, appearance, f"{label} 약 복용 인증이 완료되었어요."


def _ai_extracted(analysis: PhotoAnalysis) -> dict[str, Any]:
    """AI 가 사진에서 읽은 값. 읽지 못했거나 믿을 수 없는 값은 null."""
    return {
        "bag_slot": analysis.bag_time.value if analysis.bag_time else None,
        "pill_count": None if analysis.pills_unclear else len(analysis.pills),
        "pills": [
            {"color": p.look.color if p.look else None, "shape": p.look.shape if p.look else None}
            for p in analysis.pills
        ],
    }


def _alert_body(name: str, slot: DoseSlot, result: VerifyResult, analysis: PhotoAnalysis | None) -> str:
    label = SLOT_LABELS[slot.slot]
    if result == VerifyResult.ALREADY_TAKEN:
        return f"{name}님이 이미 드신 {label} 약을 다시 인증했어요. 두 번 드시지 않았는지 확인해 주세요."
    if result == VerifyResult.WRONG_TIME and analysis is not None and analysis.bag_time is not None:
        return f"{name}님이 {label} 약 대신 {SLOT_LABELS[analysis.bag_time]} 약봉투를 찍었어요. 확인해 주세요."
    return f"{name}님의 {label} 약 알약 개수가 등록된 개수와 달라요. 확인해 주세요."


def send_wrong_dose_alert(alert_id: int, data: dict[str, Any]) -> None:
    """WRONG_DOSE 알림(guardian_alerts 행)을 보호자 기기에 푸시하고 결과를 그 행에 적습니다.

    응답 직후 실행되고, 실패해도 인증 결과와 알림 내역은 그대로입니다.
    """
    try:
        with SessionLocal() as db:
            alert = db.get(GuardianAlert, alert_id)
            if alert is None:
                return
            tokens = list(db.scalars(select(PushToken).where(PushToken.guardian_id == alert.guardian_id)))
            if not tokens:
                return
            try:
                result = send_expo_push([t.expo_token for t in tokens], title=alert.title, body=alert.body, data=data)
            except ExpoPushError as exc:
                alert.push_error = str(exc)[:500]
            else:
                for token in tokens:
                    if token.expo_token in result.invalid_tokens:
                        db.delete(token)
                alert.push_error = ", ".join(result.errors)[:500] or None
                if result.accepted > 0:
                    alert.push_sent_at = now_local()
            db.commit()
    except Exception:
        logger.exception("WRONG_DOSE 알림 전송 실패 (alert_id=%s)", alert_id)


def _signed_url(photo_path: str | None) -> str | None:
    """사진의 10분짜리 서명 URL. 로컬 저장(Supabase 설정 없음)이거나 서명에 실패하면 null."""
    settings = get_settings()
    if not photo_path or not (settings.supabase_url and settings.supabase_service_role_key):
        return None
    try:
        return sign_dose_photos([photo_path], expires_in=PHOTO_URL_SECONDS).get(photo_path)
    except Exception:
        # 판정은 이미 저장됐으므로 여기서 500 을 내면 다시 찍다가 ALREADY_TAKEN 이 됩니다.
        logger.warning("인증 사진 서명 URL 발급 실패: %s", photo_path, exc_info=True)
        return None


def _iso(value: datetime) -> str:
    return value.replace(tzinfo=ZoneInfo(get_settings().timezone)).isoformat(timespec="seconds")


def _photo_path(slot: DoseSlot, now: datetime, mime_type: str) -> str:
    name = f"slot-{slot.id}-{now:%H%M%S}-{secrets.token_hex(4)}.{PHOTO_EXTENSIONS[mime_type]}"
    return f"patients/{slot.patient_id}/{slot.slot_date:%Y%m%d}/{name}"


@router.post("/patients/{patient_id}/dose-slots/{slot_id}/verifications")
def verify_dose(
    slot_id: int,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    patient: Patient = Depends(get_target_patient),
    analyze: PhotoAnalyzer = Depends(get_photo_analyzer),
    db: Session = Depends(get_db),
):
    slot = db.get(DoseSlot, slot_id) if 1 <= slot_id <= MAX_ID else None
    if slot is None:
        raise _error("DOSE_SLOT_NOT_FOUND")
    if slot.patient_id != patient.id:
        raise _error("FORBIDDEN")
    now = now_local()
    if slot.slot_date != now.date():
        raise _error("SLOT_NOT_TODAY")
    photo, mime_type = _read_photo(image)

    analysis: PhotoAnalysis | None = None
    appearance: dict[str, Any] | None = None
    taken_at: datetime | None = None
    photo_path: str | None = None
    if slot.status == DoseStatus.DONE:
        # taken_at, photo_url 은 먼저 인증한 기록
        first = db.scalar(
            select(DoseLog)
            .where(DoseLog.dose_slot_id == slot.id, DoseLog.result == VerifyResult.OK)
            .order_by(DoseLog.id)
            .limit(1)
        )
        if first is not None:
            taken_at, photo_path = first.created_at, first.photo_path
        result = VerifyResult.ALREADY_TAKEN
        when = f"{taken_at.hour}시 {taken_at.minute}분에 " if taken_at else ""
        message = f"{SLOT_LABELS[slot.slot]} 약은 {when}이미 드셨어요. 다시 드시지 마세요."
    else:
        try:
            analysis = analyze(photo, mime_type)
        except GeminiUnavailableError as exc:
            logger.warning("사진 분석 실패 (slot_id=%s): %s", slot_id, exc)
            raise _error("AI_UNAVAILABLE") from exc
        result, appearance, message = _judge(slot, analysis)

    log: DoseLog | None = None
    alert: GuardianAlert | None = None
    if result != VerifyResult.RETAKE:
        saved_path = save_photo(photo, path=_photo_path(slot, now, mime_type), mime_type=mime_type)
        log = DoseLog(
            dose_slot_id=slot.id,
            photo_path=saved_path,
            ai_json=analysis.raw if analysis else {"skipped": result.value},
            result=result,
            created_at=now,
        )
        db.add(log)
        if result == VerifyResult.OK:
            slot.status = DoseStatus.DONE
            taken_at, photo_path = now, saved_path
        elif result in WRONG_RESULTS:
            slot.status = DoseStatus.WRONG
            photo_path = saved_path
        if result in ALERT_RESULTS:
            # 알림 내역은 인증 기록과 같이 저장합니다. 푸시는 응답 직후 보냅니다.
            db.flush()
            alert = GuardianAlert(
                guardian_id=patient.guardian_id,
                patient_id=patient.id,
                dose_slot_id=slot.id,
                dose_log_id=log.id,
                type=GuardianAlertType.WRONG_DOSE,
                title=WRONG_DOSE_TITLE,
                body=_alert_body(patient.name, slot, result, analysis),
            )
            db.add(alert)
        db.commit()

    if alert is not None:
        alert_data = {
            "type": GuardianAlertType.WRONG_DOSE.value,
            "alert_id": alert.id,
            "result": result.value,
            "patient_id": patient.id,
            "slot_id": slot.id,
            "dose_log_id": alert.dose_log_id,
            "route": "/guardian/g03-wrong",
        }
        background_tasks.add_task(send_wrong_dose_alert, alert.id, alert_data)

    return {
        "dose_log_id": log.id if log else None,
        "slot_id": slot.id,
        "slot": slot.slot.value,
        "result": result.value,
        "slot_status": slot.status.value,
        "ai_extracted": _ai_extracted(analysis) if analysis else None,
        "expected": {"slot": slot.slot.value, "pill_count": slot.expected_count},
        "appearance_check": appearance,
        "taken_at": _iso(taken_at) if taken_at else None,
        "photo_url": _signed_url(photo_path),
        "message": message,
    }
