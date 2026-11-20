"""DB 테이블 정의 (PostgreSQL / Neon). 테이블 설명은 README 의 "DB 테이블" 항목을 참고하세요.

- 열거형 컬럼은 VARCHAR 로 저장합니다 (PostgreSQL ENUM 타입을 만들지 않아 값 추가 시 ALTER 가 필요 없음).
- JSON 컬럼은 PostgreSQL 에서 JSONB 로 저장합니다 (테스트용 SQLite 에서는 JSON).
"""

import enum
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import now_local
from app.core.database import Base
from app.enums import AlarmMode, DoseStatus, GuardianAlertType, MealTiming, Slot, VerifyResult

JSONColumn = JSON().with_variant(JSONB(), "postgresql")

# 회차·종류당 한 번만 만드는 알림 (크론 알림 + 15분 무응답). WRONG_DOSE 는 시도마다 행을 남깁니다.
CRON_ALERT_WHERE = "type IN ('MISSED', 'WELFARE_CHECK', 'MEDICATION_LOW', 'DOSE_NO_RESPONSE')"


def _enum(enum_cls: type[enum.Enum]) -> Enum:
    return Enum(enum_cls, native_enum=False, length=20, validate_strings=True)


class Guardian(Base):
    """보호자 (앱 로그인 계정)"""

    __tablename__ = "guardians"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    patients: Mapped[list["Patient"]] = relationship(
        back_populates="guardian", cascade="all, delete-orphan"
    )
    push_tokens: Mapped[list["PushToken"]] = relationship(
        back_populates="guardian", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="guardian", cascade="all, delete-orphan"
    )


class Patient(Base):
    """어르신 (복약 대상자). device_token 으로 어르신 기기를 식별합니다."""

    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    guardian_id: Mapped[int] = mapped_column(ForeignKey("guardians.id"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    # 어르신 프로필을 먼저 만든 뒤 기기를 연결하므로 초기에는 NULL입니다.
    # 원문 토큰이 아니라 SHA-256 해시를 저장합니다.
    device_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    guardian: Mapped[Guardian] = relationship(back_populates="patients")
    alarm_settings: Mapped[list["AlarmSetting"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )
    prescriptions: Mapped[list["Prescription"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )
    pairing_code: Mapped["PairingCode | None"] = relationship(
        back_populates="patient", cascade="all, delete-orphan", uselist=False
    )


class AlarmSetting(Base):
    """어르신별·회차별 알람 방식"""

    __tablename__ = "alarm_settings"

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), primary_key=True)
    slot: Mapped[Slot] = mapped_column(_enum(Slot), primary_key=True)
    mode: Mapped[AlarmMode] = mapped_column(
        _enum(AlarmMode), default=AlarmMode.POPUP, server_default=AlarmMode.POPUP.value
    )

    patient: Mapped[Patient] = relationship(back_populates="alarm_settings")


class PushToken(Base):
    """보호자 기기의 Expo 푸시 토큰 (보호자 1명이 여러 기기 가능)"""

    __tablename__ = "push_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    guardian_id: Mapped[int] = mapped_column(ForeignKey("guardians.id"), index=True)
    expo_token: Mapped[str] = mapped_column(String(255), unique=True)

    guardian: Mapped[Guardian] = relationship(back_populates="push_tokens")


class RefreshToken(Base):
    """로그인 상태를 연장하는 1회용 Refresh Token.

    원문은 로그인 응답에서만 반환하고 DB에는 해시만 저장합니다.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    guardian_id: Mapped[int] = mapped_column(ForeignKey("guardians.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    guardian: Mapped[Guardian] = relationship(back_populates="refresh_tokens")


class RevokedAccessToken(Base):
    """로그아웃된 Access Token. 기존 JWT 만료 시각까지만 보관합니다."""

    __tablename__ = "revoked_access_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class PairingCode(Base):
    """보호자가 발급하고 어르신 기기가 1회 사용하는 6자리 연결 코드."""

    __tablename__ = "pairing_codes"

    code: Mapped[str] = mapped_column(String(6), primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    patient: Mapped[Patient] = relationship(back_populates="pairing_code")


class PairAttempt(Base):
    """연결 코드 무작위 대입을 막기 위한 IP별 시도 기록."""

    __tablename__ = "pair_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_ip: Mapped[str] = mapped_column(String(45), index=True)
    attempted_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, index=True)


class DrugInfo(Base):
    """식약처 API 로 가져온 의약품 정보 캐시 (품목기준코드 기준)"""

    __tablename__ = "drug_info"

    item_seq: Mapped[str] = mapped_column(String(20), primary_key=True)  # 품목기준코드
    item_name: Mapped[str] = mapped_column(String(255))
    normalized_name: Mapped[str] = mapped_column(String(255), index=True)  # 검색용 정규화 이름
    dur_json: Mapped[Any] = mapped_column(JSONColumn)  # DUR 정보 원본
    pill_json: Mapped[Any] = mapped_column(JSONColumn)  # 낱알식별 정보 원본
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)


class Prescription(Base):
    """처방 1건 (처방전 사진 + AI 분석 결과)"""

    __tablename__ = "prescriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(Integer)  # 처방 일수
    image_path: Mapped[str | None] = mapped_column(String(500))  # UPLOAD_DIR 기준 상대 경로
    ai_json: Mapped[Any] = mapped_column(JSONColumn)  # 처방전 AI 분석 원본
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    patient: Mapped[Patient] = relationship(back_populates="prescriptions")
    drugs: Mapped[list["PrescriptionDrug"]] = relationship(
        back_populates="prescription", cascade="all, delete-orphan"
    )
    dose_slots: Mapped[list["DoseSlot"]] = relationship(
        back_populates="prescription", cascade="all, delete-orphan"
    )
    guardian_notification: Mapped["GuardianNotification | None"] = relationship(
        back_populates="prescription", cascade="all, delete-orphan", uselist=False
    )


class GuardianNotification(Base):
    """처방별 약 소진 알림과 푸시 요청 상태."""

    __tablename__ = "guardian_notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_id: Mapped[int] = mapped_column(
        ForeignKey("prescriptions.id", ondelete="CASCADE"), unique=True
    )
    depletion_date: Mapped[date] = mapped_column(Date)
    days_remaining: Mapped[int] = mapped_column(Integer)
    detected_at: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(10), default="QUEUED", server_default="QUEUED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    prescription: Mapped[Prescription] = relationship(back_populates="guardian_notification")


class PrescriptionDrug(Base):
    """처방에 포함된 약 1종"""

    __tablename__ = "prescription_drugs"

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_id: Mapped[int] = mapped_column(ForeignKey("prescriptions.id"), index=True)
    item_seq: Mapped[str | None] = mapped_column(ForeignKey("drug_info.item_seq"))  # 매칭 실패 시 NULL
    drug_name: Mapped[str] = mapped_column(String(255))  # 처방전에 적힌 이름
    count_per_dose: Mapped[int] = mapped_column(Integer)  # 1회 복용 개수
    days: Mapped[int | None] = mapped_column(Integer)  # 기존 약은 처방 일수를 사용합니다.
    slots: Mapped[list[str]] = mapped_column(JSONColumn)  # 복용 회차 목록, 예: ["MORNING", "DINNER"]
    meal_timing: Mapped[MealTiming] = mapped_column(
        _enum(MealTiming), default=MealTiming.AFTER, server_default=MealTiming.AFTER.value
    )

    prescription: Mapped[Prescription] = relationship(back_populates="drugs")
    drug_info: Mapped[DrugInfo | None] = relationship()

    def is_scheduled_on(self, slot_date: date) -> bool:
        return self.days is None or 0 <= (slot_date - self.prescription.start_date).days < self.days


class DoseSlot(Base):
    """날짜별 복용 회차 1건 (예: 11/20 아침). 처방 등록 시 일수 × 회차만큼 만들어집니다."""

    __tablename__ = "dose_slots"
    __table_args__ = (
        UniqueConstraint("prescription_id", "slot_date", "slot", name="uq_dose_slot"),
        Index("ix_dose_slots_patient_date", "patient_id", "slot_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_id: Mapped[int] = mapped_column(ForeignKey("prescriptions.id"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    slot_date: Mapped[date] = mapped_column(Date)
    slot: Mapped[Slot] = mapped_column(_enum(Slot))
    expected_count: Mapped[int] = mapped_column(Integer)  # 이 회차에 먹어야 할 알약 총 개수
    status: Mapped[DoseStatus] = mapped_column(
        _enum(DoseStatus), default=DoseStatus.PENDING, server_default=DoseStatus.PENDING.value
    )

    prescription: Mapped[Prescription] = relationship(back_populates="dose_slots")
    patient: Mapped[Patient] = relationship()
    logs: Mapped[list["DoseLog"]] = relationship(
        back_populates="dose_slot", cascade="all, delete-orphan"
    )


class DoseLog(Base):
    """복용 인증 사진 1건과 판정 결과 (회차 하나에 여러 번 시도 가능)"""

    __tablename__ = "dose_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    dose_slot_id: Mapped[int] = mapped_column(ForeignKey("dose_slots.id"), index=True)
    photo_path: Mapped[str] = mapped_column(String(500))  # UPLOAD_DIR 기준 상대 경로
    ai_json: Mapped[Any] = mapped_column(JSONColumn)  # 사진 AI 분석 원본
    result: Mapped[VerifyResult] = mapped_column(_enum(VerifyResult))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    dose_slot: Mapped[DoseSlot] = relationship(back_populates="logs")


class GuardianAlert(Base):
    """보호자 알림 내역. 크론 알림·15분 무응답은 같은 회차·종류에 한 번만, WRONG_DOSE 는 인증 시도마다 만듭니다."""

    __tablename__ = "guardian_alerts"
    __table_args__ = (
        Index(
            "uq_guardian_alert_cron_slot_type",
            "dose_slot_id",
            "type",
            unique=True,
            postgresql_where=text(CRON_ALERT_WHERE),
            sqlite_where=text(CRON_ALERT_WHERE),
        ),
        Index("uq_guardian_alert_dedupe_key", "dedupe_key", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    guardian_id: Mapped[int] = mapped_column(
        ForeignKey("guardians.id", ondelete="CASCADE"), index=True
    )
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    dose_slot_id: Mapped[int | None] = mapped_column(
        ForeignKey("dose_slots.id", ondelete="CASCADE"), index=True
    )
    # WRONG_DOSE 알림을 만든 인증 시도. 다른 종류는 NULL.
    dose_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("dose_logs.id", ondelete="CASCADE"), index=True
    )
    prescription_id: Mapped[int | None] = mapped_column(
        ForeignKey("prescriptions.id", ondelete="CASCADE")
    )
    dedupe_key: Mapped[str | None] = mapped_column(String(64))
    type: Mapped[GuardianAlertType] = mapped_column(_enum(GuardianAlertType))
    title: Mapped[str] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, index=True)
    push_sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    push_attempted_at: Mapped[datetime | None] = mapped_column(DateTime)
    push_error: Mapped[str | None] = mapped_column(String(500))

    guardian: Mapped[Guardian] = relationship()
    patient: Mapped[Patient] = relationship()
    dose_slot: Mapped[DoseSlot | None] = relationship()


class DurCheck(Base):
    """DUR 의약품 주의사항 검사 1건. 식약처 원문과 쉬운 설명을 함께 저장합니다."""

    __tablename__ = "dur_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    prescription_ids: Mapped[list[int]] = mapped_column(JSONColumn)  # 검사한 처방전 ID 목록
    check_types: Mapped[list[str]] = mapped_column(JSONColumn)  # 요청한 DUR 검사 유형
    check_status: Mapped[str] = mapped_column(String(20))
    medication_count: Mapped[int] = mapped_column(Integer)
    # [{warning_id, warning_type, medications, original_message, easy_message, source}]
    warnings_json: Mapped[Any] = mapped_column(JSONColumn)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
