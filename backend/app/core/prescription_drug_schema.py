from sqlalchemy import Engine, inspect


def upgrade_prescription_drug_schema(engine: Engine) -> None:
    """기존 약의 일수는 NULL로 남겨 처방 일수를 계속 사용하게 합니다."""
    with engine.begin() as connection:
        columns = inspect(connection).get_columns("prescription_drugs")
        if any(column["name"] == "days" for column in columns):
            return
        if engine.dialect.name == "postgresql":
            connection.exec_driver_sql("ALTER TABLE prescription_drugs ADD COLUMN IF NOT EXISTS days INTEGER")
        else:
            connection.exec_driver_sql("ALTER TABLE prescription_drugs ADD COLUMN days INTEGER")
