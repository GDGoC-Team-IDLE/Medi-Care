"""DB 와 API 에서 함께 쓰는 열거형. 값은 대문자 문자열 그대로 저장됩니다."""

from enum import StrEnum


class Slot(StrEnum):
    """복용 회차"""

    MORNING = "MORNING"
    LUNCH = "LUNCH"
    DINNER = "DINNER"
    BEDTIME = "BEDTIME"


class DoseStatus(StrEnum):
    """회차(dose_slots)의 복용 상태"""

    PENDING = "PENDING"  # 아직 복용 전
    DONE = "DONE"  # 복용 완료
    MISSED = "MISSED"  # 미복용
    WRONG = "WRONG"  # 잘못 복용


class VerifyResult(StrEnum):
    """복용 인증 사진 1건(dose_logs)의 판정 결과"""

    OK = "OK"
    WRONG_TIME = "WRONG_TIME"  # 복용 시간이 아님
    ALREADY_TAKEN = "ALREADY_TAKEN"  # 이미 복용한 회차
    COUNT_MISMATCH = "COUNT_MISMATCH"  # 알약 개수 불일치
    APPEARANCE_MISMATCH = "APPEARANCE_MISMATCH"  # 알약 색·모양 불일치
    RETAKE = "RETAKE"  # 사진 재촬영 필요


class AppearanceStatus(StrEnum):
    """복용 인증 응답의 알약 색·모양 비교 결과 (DB 에는 저장하지 않음)"""

    MATCH = "MATCH"  # 등록된 약과 색·모양이 모두 맞음
    MISMATCH = "MISMATCH"  # 빠진 약이 있거나 다른 모양의 알약이 있음
    COUNT_ONLY = "COUNT_ONLY"  # 색·모양으로 약을 구별할 수 없어 개수만 확인함
    RETAKE = "RETAKE"  # 사진으로 색·모양을 확인할 수 없음


class AlarmMode(StrEnum):
    """알람 표시 방식"""

    POPUP = "POPUP"
    FULLSCREEN = "FULLSCREEN"


class GuardianAlertType(StrEnum):
    """보호자에게 전송하는 알림 종류"""

    # MISSED(예정 시각 + 60분)와 구분되는 단계적 알림의 15분 무응답 이벤트입니다.
    DOSE_NO_RESPONSE = "DOSE_NO_RESPONSE"
    MISSED = "MISSED"
    WELFARE_CHECK = "WELFARE_CHECK"
    MEDICATION_LOW = "MEDICATION_LOW"


class MealTiming(StrEnum):
    """식전/식후"""

    BEFORE = "BEFORE"
    AFTER = "AFTER"
    ANY = "ANY"
