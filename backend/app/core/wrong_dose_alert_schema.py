from sqlalchemy import Engine, inspect

from app.models import CRON_ALERT_WHERE

CRON_INDEX = "uq_guardian_alert_cron_slot_type"


def upgrade_wrong_dose_alert_schema(engine: Engine) -> None:
    """이미 배포된 guardian_alerts 에 WRONG_DOSE 기록용 변경을 적용합니다 (create_all 은 기존 테이블을 바꾸지 않음).

    - dose_log_id 컬럼 추가
    - UNIQUE(dose_slot_id, type) 제약 → WRONG_DOSE 를 뺀 알림에만 걸리는 부분 유니크 인덱스
    """
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as connection:
        inspector = inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("guardian_alerts")}
        indexes = {index["name"] for index in inspector.get_indexes("guardian_alerts")}
        if "dose_log_id" in columns and CRON_INDEX in indexes:
            return
        connection.exec_driver_sql("""
            ALTER TABLE guardian_alerts
                ADD COLUMN IF NOT EXISTS dose_log_id INTEGER REFERENCES dose_logs (id) ON DELETE CASCADE,
                DROP CONSTRAINT IF EXISTS uq_guardian_alert_slot_type
        """)
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_guardian_alerts_dose_log_id ON guardian_alerts (dose_log_id)"
        )
        connection.exec_driver_sql(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {CRON_INDEX} ON guardian_alerts (dose_slot_id, type) "
            f"WHERE {CRON_ALERT_WHERE}"
        )
