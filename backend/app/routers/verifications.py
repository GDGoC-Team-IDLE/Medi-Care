"""복약 인증: 복용자가 뜯은 약봉투와 꺼낸 알약을 사진 1장으로 찍어 회차 복용을 인증합니다.

    POST /api/v1/patients/{patient_id}/dose-slots/{slot_id}/verifications   (multipart, 필드 photo)

인증: 어르신 기기 토큰. X-Device-Token 헤더 또는 Authorization: Bearer <기기 토큰>.
응답: {"success": true, "data": {...}} / {"success": false, "error": {"code", "message"}}

판정 순서 (앞에서 걸리면 거기서 끝)
1. 이미 완료된 회차                       → ALREADY_TAKEN (사진 분석 안 함)
2. 알약 개수·색·모양이나 봉투 시간을 못 읽음 → RETAKE
3. 봉투 시간 ≠ 회차                        → WRONG_TIME
4. 알약 수 ≠ 회차 예상 개수                 → COUNT_MISMATCH
5. 빠진 약 / 등록되지 않은 색·모양의 알약    → APPEARANCE_MISMATCH
6. 그 밖                                  → OK (회차 DONE). 색·모양이 같은 약끼리는 개수만 확인 (COUNT_ONLY)

AI(Gemini)는 사진에서 특징만 뽑고, 위 판정은 모두 서버가 합니다.
OK 가 아니면 회차 상태는 그대로 두고(다시 찍을 수 있음), 시도마다 dose_logs 에 한 줄씩 남깁니다.
"""

import logging
import secrets
from collections.abc import Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Header, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import get_db
from app.core.envelope import ApiError, EnvelopeRoute, success
from app.enums import AppearanceStatus, DoseStatus, Slot, VerifyResult
from app.models import DoseLog, DoseSlot, Patient
from app.security import token_hash
from app.services.dose_photo import PhotoAnalysis, analyze_dose_photo
from app.services.gemini import GeminiUnavailableError
from app.services.photo_storage import save_photo
from app.services.pill_appearance import AppearanceCheck, ExpectedPill, appearance_from_mfds, compare

logger = logging.getLogger(__name__)


class VerificationRoute(EnvelopeRoute):
    invalid_request_message = "복약 인증 요청 정보가 올바르지 않습니다."
    internal_error_message = "복약 인증 처리 중 오류가 발생했습니다."


router = APIRouter(tags=["verifications"], route_class=VerificationRoute)
bearer = HTTPBearer(auto_error=False)

SLOT_LABELS = {Slot.MORNING: "아침", Slot.LUNCH: "점심", Slot.DINNER: "저녁", Slot.BEDTIME: "자기 전"}
PHOTO_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}

RETAKE_PILLS_MESSAGE = "알약의 색상과 모양을 정확히 확인하기 어려워요. 다시 촬영해 주세요."
RETAKE_BAG_MESSAGE = "약봉투의 시간 표시가 잘 보이지 않아요. 봉투가 함께 나오게 다시 촬영해 주세요."
MISMATCH_MESSAGE = (
    "알약의 색상이나 모양이 등록된 정보와 달라요. 복약 안내문을 확인하고 의사나 약사에게 문의해 주세요."
)

PhotoAnalyzer = Callable[[bytes, str], PhotoAnalysis]


def get_photo_analyzer() -> PhotoAnalyzer:
    """사진 분석 함수. 테스트에서는 app.dependency_overrides 로 가짜 분석기로 바꿉니다."""
    return analyze_dose_photo


def get_device_patient(
    x_device_token: str | None = Header(default=None, alias="X-Device-Token"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Patient:
    """어르신 기기 토큰으로 복용자를 찾습니다. 보호자와 같은 폰이면 Bearer 에 보호자 JWT 가 올 수 있어 둘 다 확인합니다."""
    candidates = [x_device_token]
    if credentials is not None and credentials.scheme.lower() == "bearer":
        candidates.append(credentials.credentials)
    for raw in candidates:
        if raw:
            patient = db.scalar(select(Patient).where(Patient.device_token == token_hash(raw)))
            if patient is not None:
                return patient
    raise ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.")


def _sniff_image_type(data: bytes) -> str | None:
    """파일 앞부분으로 이미지 형식을 알아냅니다 (앱이 보내는 Content-Type 은 믿지 않음)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx"):
            return "image/heic"
        if brand in (b"mif1", b"msf1"):
            return "image/heif"
    return None


def _read_photo(photo: UploadFile) -> tuple[bytes, str]:
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = photo.file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "FILE_TOO_LARGE", "사진 파일 크기가 너무 큽니다.")
    mime_type = _sniff_image_type(data)
    if mime_type is None:
        raise ApiError(400, "INVALID_REQUEST", "복약 인증 요청 정보가 올바르지 않습니다.")
    return data, mime_type


def _expected_pills(slot: DoseSlot) -> list[ExpectedPill]:
    """이 회차에 먹을 약을 알 단위로 펼칩니다. 식약처 정보가 없는 약은 look=None."""
    pills: list[ExpectedPill] = []
    for drug in slot.prescription.drugs:
        if str(slot.slot) not in (drug.slots or []):
            continue
        look = appearance_from_mfds(drug.drug_info.pill_json) if drug.drug_info else None
        pills.extend(ExpectedPill(drug.id, look) for _ in range(drug.count_per_dose))
    return pills


def _warnings(check: AppearanceCheck) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for gap in check.missing:
        look = gap.look
        if gap.seen == 0:
            message = f"등록된 {look.color} {look.shape} 알약이 사진에서 확인되지 않아요."
        else:
            message = f"등록된 {look.color} {look.shape} 알약이 {gap.count}개 부족해요."
        warnings.append(
            {
                "warning_type": "MISSING_PILL",
                "expected_color": look.color,
                "expected_shape": look.shape,
                "message": message,
            }
        )
    for gap in check.unexpected:
        count = f" {gap.count}개" if gap.count > 1 else ""
        warnings.append(
            {
                "warning_type": "UNEXPECTED_PILL",
                "detected_color": gap.look.color,
                "detected_shape": gap.look.shape,
                "message": f"등록된 약과 다른 색상 또는 모양의 알약이{count} 보여요.",
            }
        )
    return warnings


def _judge(slot: DoseSlot, analysis: PhotoAnalysis) -> tuple[VerifyResult, dict[str, Any], str]:
    """사진 분석 결과를 회차 정보·식약처 정보와 비교해 (판정, appearance_check, 안내 문구)를 정합니다."""
    retake = {"status": AppearanceStatus.RETAKE.value, "warnings": []}
    if analysis.pills_unclear:
        return VerifyResult.RETAKE, retake, RETAKE_PILLS_MESSAGE
    if analysis.bag_time is None:
        return VerifyResult.RETAKE, retake, RETAKE_BAG_MESSAGE

    detected = analysis.looks
    check = compare(_expected_pills(slot), detected, slot.expected_count)
    appearance = {
        "status": check.status.value,
        "expected_count": slot.expected_count,
        "detected_count": len(detected),
        "warnings": _warnings(check),
    }

    label = SLOT_LABELS[slot.slot]
    if analysis.bag_time != slot.slot:
        bag_label = SLOT_LABELS[analysis.bag_time]
        return VerifyResult.WRONG_TIME, appearance, f"{bag_label} 약봉투예요. {label} 약봉투인지 확인해 주세요."

    diff = len(detected) - slot.expected_count
    if diff != 0:
        state = f"{-diff}개 모자라요" if diff < 0 else f"{diff}개 더 있어요"
        message = f"알약이 {state}. {slot.expected_count}개가 맞는지 다시 세어 주세요."
        return VerifyResult.COUNT_MISMATCH, appearance, message

    if check.status == AppearanceStatus.MISMATCH:
        return VerifyResult.APPEARANCE_MISMATCH, appearance, MISMATCH_MESSAGE
    if check.status == AppearanceStatus.COUNT_ONLY:
        reason = "등록된 약의 색상·모양 정보가 없어" if check.no_info else "색상과 모양이 같아"
        return VerifyResult.OK, appearance, f"알약 {len(detected)}개가 확인되었어요. {reason} 약 종류는 구별하지 못했어요."
    return VerifyResult.OK, appearance, f"{label} 약 복용 인증이 완료되었습니다."


def _ai_extracted(analysis: PhotoAnalysis) -> dict[str, Any]:
    return {
        "bag_time": analysis.bag_time.value if analysis.bag_time else "UNKNOWN",
        "pill_count": len(analysis.pills),
        "pills": [
            {"color": p.look.color if p.look else None, "shape": p.look.shape if p.look else None}
            for p in analysis.pills
        ],
    }


def _photo_path(slot: DoseSlot, now: datetime, mime_type: str) -> str:
    name = f"slot-{slot.id}-{now:%H%M%S}-{secrets.token_hex(4)}.{PHOTO_EXTENSIONS[mime_type]}"
    return f"patients/{slot.patient_id}/{slot.slot_date:%Y%m%d}/{name}"


@router.post("/patients/{patient_id}/dose-slots/{slot_id}/verifications")
def verify_dose(
    patient_id: int,
    slot_id: int,
    photo: UploadFile = File(...),
    patient: Patient = Depends(get_device_patient),
    analyze: PhotoAnalyzer = Depends(get_photo_analyzer),
    db: Session = Depends(get_db),
):
    if patient.id != patient_id:
        raise ApiError(403, "FORBIDDEN", "해당 복약 정보를 인증할 권한이 없습니다.")
    slot = db.get(DoseSlot, slot_id)
    if slot is None or slot.patient_id != patient_id:
        raise ApiError(404, "DOSE_SLOT_NOT_FOUND", "복약 회차 정보를 찾을 수 없습니다.")
    image, mime_type = _read_photo(photo)

    analysis: PhotoAnalysis | None = None
    appearance: dict[str, Any] | None = None
    if slot.status == DoseStatus.DONE:
        result = VerifyResult.ALREADY_TAKEN
        message = f"{SLOT_LABELS[slot.slot]} 약은 이미 복용 인증을 마쳤어요."
    else:
        try:
            analysis = analyze(image, mime_type)
        except GeminiUnavailableError as exc:
            logger.warning("사진 분석 실패 (slot_id=%s): %s", slot_id, exc)
            raise ApiError(503, "AI_SERVICE_UNAVAILABLE", "사진 분석 서비스를 이용할 수 없습니다.") from exc
        result, appearance, message = _judge(slot, analysis)

    now = now_local()
    photo_path = save_photo(image, path=_photo_path(slot, now, mime_type), mime_type=mime_type)
    db.add(
        DoseLog(
            dose_slot_id=slot.id,
            photo_path=photo_path,
            ai_json=analysis.raw if analysis else {"skipped": result.value},
            result=result,
            created_at=now,
        )
    )
    verified = result == VerifyResult.OK
    if verified:
        slot.status = DoseStatus.DONE
    db.commit()

    data: dict[str, Any] = {
        "patient_id": patient_id,
        "slot_id": slot_id,
        "result_code": result.value,
        "verified": verified,
    }
    if analysis is not None:
        data["ai_extracted"] = _ai_extracted(analysis)
    if appearance is not None:
        data["appearance_check"] = appearance
    if verified:
        tz = ZoneInfo(get_settings().timezone)
        data["verified_at"] = now.replace(tzinfo=tz).isoformat(timespec="seconds")
    data["message"] = message
    return success(data)
