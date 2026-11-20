import json
from collections.abc import Iterable
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.core.config import get_settings

PHOTO_URL_EXPIRY_SECONDS = 300


def sign_dose_photos(photo_paths: Iterable[str], expires_in: int = PHOTO_URL_EXPIRY_SECONDS) -> dict[str, str]:
    paths = list(dict.fromkeys(photo_paths))
    if not paths:
        return {}

    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase Storage 설정이 필요합니다.")

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
