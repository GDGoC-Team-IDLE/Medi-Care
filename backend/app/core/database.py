from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

_url = get_settings().sqlalchemy_url

if _url.get_backend_name() == "sqlite":
    # 테스트용
    engine = create_engine(_url, connect_args={"check_same_thread": False})
else:
    # Neon 은 쉬는 동안 연결을 끊으므로, 쓰기 전에 연결을 확인하고 5분마다 새로 맺습니다.
    engine = create_engine(_url, pool_pre_ping=True, pool_recycle=300)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
