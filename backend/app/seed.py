"""시연용 데이터 넣기.

    python -m app.seed                               # 로컬 (backend 폴더에서)
    docker compose exec backend python -m app.seed   # 도커

보호자 1명, 어르신 1명, 처방 1건, 약 2종, 오늘 복용 회차 3개를 만듭니다.
이미 시연용 보호자가 있으면 새로 만들지 않고, 기기 토큰만 맞춘 뒤 어르신·회차 id 를 보여 줍니다.

어르신 기기로 부르는 API 는 X-Device-Token: seed-device-0001 헤더로 시험할 수 있습니다.
"""

from collections import Counter

from sqlalchemy import select

from app import models  # noqa: F401
from app.core.clock import now_local
from app.core.database import Base, SessionLocal, engine
from app.enums import MealTiming, Slot
from app.models import DoseSlot, Guardian, Patient, Prescription, PrescriptionDrug
from app.security import token_hash

SEED_EMAIL = "guardian@example.com"
SEED_DEVICE_TOKEN = "seed-device-0001"  # DB 에는 해시로 저장 (patients.device_token)

# 로그인 기능이 아직 없어 실제 해시가 아닙니다. 인증 담당자가 해시 방식을 정하면 여기도 바꿔 주세요.
SEED_PASSWORD_HASH = "!seed-not-a-real-hash"

SEED_DRUGS = [
    # (약 이름, 1회 개수, 복용 회차, 식전/식후)
    ("아세트아미노펜정 500mg", 1, [Slot.MORNING, Slot.LUNCH, Slot.DINNER], MealTiming.AFTER),
    ("메트포르민정 500mg", 1, [Slot.MORNING, Slot.DINNER], MealTiming.AFTER),
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        existing = db.scalar(select(Patient).join(Guardian).where(Guardian.email == SEED_EMAIL))
        if existing is not None:
            existing.device_token = token_hash(SEED_DEVICE_TOKEN)
            db.commit()
            print(f"이미 시연용 데이터가 있습니다 ({SEED_EMAIL}). 기기 토큰만 맞췄습니다.")
            _print_slots(existing)
            return

        today = now_local().date()

        guardian = Guardian(email=SEED_EMAIL, password_hash=SEED_PASSWORD_HASH, name="김보호")
        patient = Patient(guardian=guardian, name="이순자", device_token=token_hash(SEED_DEVICE_TOKEN))
        prescription = Prescription(
            patient=patient, start_date=today, days=7, image_path=None, ai_json={"source": "seed"}
        )
        db.add_all([guardian, patient, prescription])

        expected: Counter[Slot] = Counter()
        for name, count, slots, meal in SEED_DRUGS:
            db.add(
                PrescriptionDrug(
                    prescription=prescription,
                    item_seq=None,
                    drug_name=name,
                    count_per_dose=count,
                    slots=[s.value for s in slots],
                    meal_timing=meal,
                )
            )
            for s in slots:
                expected[s] += count

        # 오늘 회차: 아침 2개, 점심 1개, 저녁 2개
        for slot in (Slot.MORNING, Slot.LUNCH, Slot.DINNER):
            db.add(
                DoseSlot(
                    prescription=prescription,
                    patient=patient,
                    slot_date=today,
                    slot=slot,
                    expected_count=expected[slot],
                )
            )

        db.commit()
        print(
            f"시연용 데이터 생성 완료: 보호자 id={guardian.id}, 어르신 id={patient.id}, "
            f"처방 id={prescription.id}, 약 {len(SEED_DRUGS)}종, 오늘({today}) 회차 3개"
        )
        _print_slots(patient)


def _print_slots(patient: Patient) -> None:
    print(f"어르신 id={patient.id}, 기기 토큰(X-Device-Token)={SEED_DEVICE_TOKEN}")
    for p in patient.prescriptions:
        for s in sorted(p.dose_slots, key=lambda s: (s.slot_date, s.id)):
            print(f"  회차 id={s.id}  {s.slot_date} {s.slot.value:<8} {s.expected_count}알  {s.status.value}")


if __name__ == "__main__":
    seed()
