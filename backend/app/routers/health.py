from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """서버와 DB 연결 상태 확인. DB 에 연결할 수 없으면 500 이 납니다."""
    db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
