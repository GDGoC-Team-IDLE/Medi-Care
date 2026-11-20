import logging
import re
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.clock import now_local
from app.core.config import get_settings
from app.core.database import get_db
from app.core.envelope import ApiError
from app.dose_schedule import SLOT_TIMES
from app.enums import MealTiming, Slot
from app.models import DoseSlot, Prescription, PrescriptionDrug
from app.routers.auth import bearer
from app.routers.dose_status import _resolve_patient, device_header
from app.services.mfds_catalog import cache_prescription_drugs

logger = logging.getLogger(__name__)
SLOT_LABELS = {Slot.MORNING: "아침", Slot.LUNCH: "점심", Slot.DINNER: "저녁", Slot.BEDTIME: "취침 전"}
ERRORS = {
    400: ("VALIDATION_ERROR", "약 정보를 다시 확인해 주세요."),
    401: ("UNAUTHORIZED", "로그인 정보가 없어요. 다시 로그인해 주세요."),
    403: ("FORBIDDEN", "이 어르신의 정보에 접근할 수 없어요."),
    404: ("PATIENT_NOT_FOUND", "어르신 정보를 찾을 수 없어요."),
    500: ("INTERNAL_ERROR", "일시적인 오류가 발생했어요."),
}


def _error(status_code: int, detail: str | None = None) -> JSONResponse:
    code, message = ERRORS[status_code]
    if detail:
        message += f" ({detail})"
    return JSONResponse({"code": code, "message": message}, status_code=status_code)


def _validation_detail(exc: RequestValidationError) -> str | None:
    error = exc.errors()[0]
    parts = [part for part in error["loc"] if part != "body"]
    field = "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in parts).lstrip(".")
    if not field:
        return None
    messages = {
        "count_per_dose": "1회 개수는 1~10 사이의 정수로 보내 주세요",
        "days": "복용 일수는 1~90 사이의 정수로 보내 주세요",
        "name": "약 이름을 입력해 주세요",
        "start_date": "시작일은 YYYY-MM-DD 형식으로 보내 주세요",
        "meal_timing": "식전·식후·무관 중 하나를 골라 주세요",
    }
    leaf = next((part for part in reversed(parts) if isinstance(part, str)), "")
    if leaf == "slots":
        message = (
            "시간대를 1개 이상 골라 주세요" if error["type"] in {"too_short", "missing"}
            else "지원하는 시간대를 골라 주세요"
        )
    else:
        message = messages.get(leaf, "값을 확인해 주세요")
    return f"{field}: {message}"


class PrescriptionRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                return _error(400, _validation_detail(exc))
            except ApiError as exc:
                return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status_code)
            except HTTPException as exc:
                if exc.status_code in ERRORS:
                    return _error(exc.status_code)
                raise
            except Exception as exc:
                logger.error("Could not save prescription: %s", type(exc).__name__)
                return _error(500)

        return handle


router = APIRouter(tags=["prescriptions"], route_class=PrescriptionRoute)


class DrugRequest(BaseModel):
    name: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=255)]
    count_per_dose: int = Field(strict=True, ge=1, le=10)
    slots: list[Slot] = Field(min_length=1)
    meal_timing: MealTiming | None = None
    days: int = Field(strict=True, ge=1, le=90)

    @field_validator("slots")
    @classmethod
    def unique_slots(cls, slots: list[Slot]) -> list[Slot]:
        return list(dict.fromkeys(slots))


class PrescriptionRequest(BaseModel):
    start_date: date | None = None
    drugs: list[DrugRequest] = Field(min_length=1)

    @field_validator("start_date", mode="before")
    @classmethod
    def check_date(cls, value: object) -> object:
        if value is not None and (
            not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)
        ):
            raise ValueError("Expected YYYY-MM-DD")
        return value


class SavedDrug(BaseModel):
    drug_id: int
    name: str
    item_seq: str | None
    count_per_dose: int
    slots: list[Slot]
    meal_timing: MealTiming
    days: int


class SavedSlot(BaseModel):
    slot_id: int
    slot_date: date
    slot: Slot
    scheduled_at: datetime
    expected_count: int


class PrescriptionResponse(BaseModel):
    prescription_id: int
    start_date: date
    end_date: date
    drugs: list[SavedDrug]
    slots: list[SavedSlot]
    skipped_today: list[Slot]
    message: str


class PrescriptionError(BaseModel):
    code: str
    message: str


def _plan_slots(
    start: date, now: datetime, drugs: list[DrugRequest]
) -> tuple[Counter[tuple[date, Slot]], list[Slot]]:
    plan: Counter[tuple[date, Slot]] = Counter()
    skipped: set[Slot] = set()
    today = now.date()
    first_day = max(0, (today - start).days)
    for drug in drugs:
        for offset in range(first_day, drug.days):
            day = start + timedelta(days=offset)
            for slot in drug.slots:
                if day == today and SLOT_TIMES[slot] < now.time():
                    skipped.add(slot)
                else:
                    plan[day, slot] += drug.count_per_dose
    return plan, sorted(skipped, key=SLOT_TIMES.__getitem__)


@router.post(
    "/patients/{patient_id}/prescriptions",
    status_code=201,
    response_model=PrescriptionResponse,
    responses={code: {"model": PrescriptionError} for code in ERRORS},
)
def create_prescription(
    patient_id: Annotated[str, Path(description="보호자는 어르신 ID, 어르신 폰은 me")],
    data: PrescriptionRequest,
    device_token: str | None = Depends(device_header),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    patient = _resolve_patient(patient_id, device_token, credentials, db)
    now = now_local()
    start = data.start_date or now.date()
    days = max(drug.days for drug in data.drugs)
    try:
        end = start + timedelta(days=days - 1)
    except OverflowError:
        return _error(400, "start_date: 복용 종료일이 지원 범위를 벗어났어요")
    plan, skipped = _plan_slots(start, now, data.drugs)
    if not plan:
        raise ApiError(
            400, "NO_SLOTS_CREATED",
            "오늘 남은 복용 시간이 없어 일정을 만들 수 없어요. 시작일을 내일로 바꿔 주세요.",
        )

    prescription = Prescription(patient_id=patient.id, start_date=start, days=days, ai_json={})
    prescription.drugs = [
        PrescriptionDrug(
            drug_name=drug.name,
            count_per_dose=drug.count_per_dose,
            slots=[slot.value for slot in drug.slots],
            meal_timing=drug.meal_timing or MealTiming.AFTER,
            days=drug.days,
        )
        for drug in data.drugs
    ]
    prescription.dose_slots = [
        DoseSlot(patient_id=patient.id, slot_date=day, slot=slot, expected_count=plan[day, slot])
        for day, slot in sorted(plan, key=lambda key: (key[0], SLOT_TIMES[key[1]]))
    ]
    db.add(prescription)
    db.flush()
    settings = get_settings()
    timezone = ZoneInfo(settings.timezone)
    saved = PrescriptionResponse(
        prescription_id=prescription.id,
        start_date=start,
        end_date=end,
        drugs=[
            SavedDrug(
                drug_id=row.id, name=row.drug_name, item_seq=None,
                count_per_dose=row.count_per_dose, slots=drug.slots,
                meal_timing=row.meal_timing, days=drug.days,
            )
            for row, drug in zip(prescription.drugs, data.drugs, strict=True)
        ],
        slots=[
            SavedSlot(
                slot_id=row.id, slot_date=row.slot_date, slot=row.slot,
                scheduled_at=datetime.combine(row.slot_date, SLOT_TIMES[row.slot], timezone),
                expected_count=row.expected_count,
            )
            for row in prescription.dose_slots
        ],
        skipped_today=skipped,
        message=f"복용 일정 {len(plan)}회를 만들었어요.",
    )
    if skipped:
        names = "·".join(SLOT_LABELS[slot] for slot in skipped)
        saved.message += f" 오늘 {names}은 이미 지나서 빼 두었어요."
    db.commit()

    # 식약처 조회 결과는 이미 저장된 처방과 일정을 되돌리지 않습니다.
    try:
        linked = cache_prescription_drugs(
            db, [(drug.drug_id, drug.name) for drug in saved.drugs], settings.mfds_service_key
        )
    except Exception as exc:
        db.rollback()
        logger.warning("Could not cache medication information: %s", type(exc).__name__)
    else:
        for drug in saved.drugs:
            drug.item_seq = linked.get(drug.drug_id)
    return saved
