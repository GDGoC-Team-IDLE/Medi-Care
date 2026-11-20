import json
import logging
from collections.abc import Iterable
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.core.config import get_settings

PHOTO_URL_EXPIRY_SECONDS = 300
logger = logging.getLogger(__name__)


def sign_dose_photos(photo_paths: Iterable[str], expires_in: int = PHOTO_URL_EXPIRY_SECONDS) -> dict[str, str]:
    """인증 사진 경로 → 잠깐 쓸 수 있는 서명 URL.

    사진 주소를 못 만들어도(Supabase 설정 없음 · Supabase 오류) 빈 dict 를 돌려줍니다.
    회차·복용 기록 조회(dose_slots · dose_status · guardian_doses)가 사진 하나 때문에 통째로 500 이 되지 않고,
    사진만 빠진 채 보이게 하기 위해서입니다.
    """
    paths = list(dict.fromkeys(photo_paths))
    if not paths:
        return {}

    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        # Supabase 없이 서버 디스크(UPLOAD_DIR)에 저장한 사진은 서명 URL 이 없습니다.
        logger.warning("Supabase Storage 설정이 없어 인증 사진 주소를 만들지 않습니다 (%d장).", len(paths))
        return {}
    try:
        return _sign(paths, expires_in, settings)
    except Exception as exc:
        logger.warning("인증 사진 서명 URL 발급 실패: %s", type(exc).__name__)
        return {}


def _sign(paths: list[str], expires_in: int, settings) -> dict[str, str]:
    storage_url = f"{settings.supabase_url.rstrip('/')}/storage/v1"
    bucket = quote(settings.supabase_bucket, safe="")
    key = settings.supabase_service_role_key
    request = Request(
        f"{storage_url}/object/sign/{bucket}",
        data=json.dumps({"paths": paths, "expiresIn": expires_in}).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        signed_photos = json.load(response)

    urls = {}
    for photo in signed_photos:
        signed_url = photo["signedURL"]
        if signed_url is None:
            continue  # 이 파일이 없어도 회차 상태와 중복 경고를 제공할 수 있습니다.
        path, separator, token = signed_url.rpartition("?token=")
        if not path.startswith(f"/object/sign/{bucket}/") or not separator or not token:
            raise ValueError("잘못된 Supabase Storage 서명 URL입니다.")
        urls[photo["path"]] = f"{storage_url}{quote(path, safe='/%')}?token={token}"
    return urls
