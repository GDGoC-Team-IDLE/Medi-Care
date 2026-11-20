from sqlalchemy import Engine, inspect


def upgrade_guardian_alert_schema(engine: Engine) -> None:
    """create_all이 이미 배포된 PostgreSQL 테이블에 추가하지 못하는 컬럼을 보완합니다."""
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as connection:
        inspector = inspect(connection)
        columns = {column["name"]: column for column in inspector.get_columns("guardian_alerts")}
        indexes = {index["name"] for index in inspector.get_indexes("guardian_alerts")}
        if {"prescription_id", "dedupe_key", "push_attempted_at"}.issubset(columns) and (
            columns["dose_slot_id"]["nullable"] and "uq_guardian_alert_dedupe_key" in indexes
        ):
            return
        connection.exec_driver_sql("""
            ALTER TABLE guardian_alerts
                ALTER COLUMN dose_slot_id DROP NOT NULL,
                ADD COLUMN IF NOT EXISTS prescription_id INTEGER
                    REFERENCES prescriptions (id) ON DELETE CASCADE,
                ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(64),
                ADD COLUMN IF NOT EXISTS push_attempted_at TIMESTAMP WITHOUT TIME ZONE
        """)
        connection.exec_driver_sql("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_alert_dedupe_key
            ON guardian_alerts (dedupe_key)
        """)
