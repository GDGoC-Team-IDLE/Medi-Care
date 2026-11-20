"""인증 사진 저장.

SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 있으면 Supabase Storage(비공개 버킷)에,
없으면 UPLOAD_DIR(로컬 테스트용)에 저장합니다. 어느 쪽이든 같은 상대 경로를 dose_logs.photo_path 에 남깁니다.
"""

import logging
from pathlib import Path

import httpx2

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class PhotoStorageError(Exception):
    pass


def save_photo(data: bytes, *, path: str, mime_type: str) -> str:
    """사진을 path(버킷/UPLOAD_DIR 기준 상대 경로)에 저장하고 그 경로를 돌려줍니다."""
    settings = get_settings()
    if settings.supabase_url and settings.supabase_service_role_key:
        _upload_to_supabase(data, path=path, mime_type=mime_type)
    else:
        target = Path(settings.upload_dir) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return path


def _upload_to_supabase(data: bytes, *, path: str, mime_type: str) -> None:
    settings = get_settings()
    key = settings.supabase_service_role_key
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.supabase_bucket}/{path}"
    try:
        res = httpx2.post(
            url,
            content=data,
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": mime_type,
                "x-upsert": "false",
            },
            timeout=20,
        )
    except httpx2.HTTPError as exc:
        raise PhotoStorageError(f"Supabase 업로드 실패: {type(exc).__name__}") from exc
    if res.status_code >= 300:
        logger.warning("Supabase 업로드 오류 %s: %s", res.status_code, res.text[:300])
        raise PhotoStorageError(f"Supabase 업로드 오류 ({res.status_code})")
