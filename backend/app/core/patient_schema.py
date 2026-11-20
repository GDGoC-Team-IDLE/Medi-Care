from sqlalchemy import Engine, inspect


def upgrade_patient_schema(engine: Engine) -> None:
    """처음 배포된 PostgreSQL 의 patients.device_token 은 NOT NULL 이었습니다.
    지금은 어르신을 먼저 만들고 기기는 연결 숫자로 나중에 연결하므로 NULL 을 허용합니다.
    (create_all 은 이미 있는 컬럼을 바꾸지 않습니다)
    """
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as connection:
        columns = {column["name"]: column for column in inspect(connection).get_columns("patients")}
        if columns["device_token"]["nullable"]:
            return
        connection.exec_driver_sql("ALTER TABLE patients ALTER COLUMN device_token DROP NOT NULL")
