from starlette.datastructures import UploadFile

from app.core.envelope import ApiError


def read_photo(photo: UploadFile, *, limit_mb: int) -> tuple[bytes, str]:
    limit = limit_mb * 1024 * 1024
    data = photo.file.read(limit + 1)
    if not data:
        raise ApiError(400, "IMAGE_REQUIRED", "사진을 첨부해 주세요.")
    if len(data) > limit:
        raise ApiError(413, "IMAGE_TOO_LARGE", f"사진은 {limit_mb}MB 이하만 올릴 수 있어요.")

    # 파일 이름이나 앱이 지정한 Content-Type 대신 파일 헤더를 검사합니다.
    if data.startswith(b"\xff\xd8\xff"):
        return data, "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data, "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return data, "image/webp"
    raise ApiError(415, "UNSUPPORTED_IMAGE_TYPE", "jpg, png, webp 사진만 올릴 수 있어요.")
