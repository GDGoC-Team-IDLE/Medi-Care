from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url


def to_sqlalchemy_url(raw: str) -> URL:
    """DATABASE_URL 을 SQLAlchemy 주소로 바꿉니다.

    Neon 이 주는 postgresql://...?sslmode=require 를 그대로 넣어도 되게
    드라이버만 psycopg(3) 로 바꾸고, sslmode 등 쿼리 파라미터는 그대로 둡니다.
    테스트용 sqlite:/// 주소는 손대지 않습니다.
    """
    url = make_url(raw.strip())
    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+psycopg")
    return url


class Settings(BaseSettings):
    """환경 변수 설정. 이름은 대소문자 구분 없이 매칭됩니다 (DATABASE_URL -> database_url).

    기능별 설정(외부 API 키 등)은 각 담당자가 필요할 때 여기에 추가합니다.
    """

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_name: str = "Medi-Care API"
    timezone: str = "Asia/Seoul"

    # ── DB (필수) ──
    # Neon 연결 주소 그대로: postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
    # 테스트는 sqlite:///./test.db 같은 주소를 씁니다.
    database_url: str

    # ── 인증 사진 저장소: Supabase Storage ──
    supabase_url: str = ""
    supabase_service_role_key: str = ""  # 서버 전용 키. 앱·웹 코드에 절대 넣지 않습니다.
    supabase_bucket: str = "dose-photos"

    # ── 로컬 파일 저장 (로컬 테스트용) ──
    # Render 서버 디스크는 재시작·재배포 때 지워지므로 운영 사진은 Supabase 에 저장합니다.
    upload_dir: str = "/app/uploads"
    max_upload_mb: int = 10

    # ── CORS ──
    # 다른 주소에서 API 를 부를 때 허용할 출처. 쉼표로 여러 개.
    # 기본값은 expo start --web 개발 서버. Render 에서는 웹 주소(https://medi-care-web.onrender.com)를 넣습니다.
    cors_origins: str = "http://localhost:8081"

    # ── 주기 작업 ──
    # 외부 크론(cron-job.org)이 POST /api/v1/internal/tick 을 부를 때 X-Cron-Secret 헤더로 보내는 값
    cron_secret: str = ""
    internal_token: str = ""  # 보호자 알림 API 호출용 Bearer 토큰
    expo_access_token: str = ""  # Expo Push 보안이 활성화된 프로젝트에서 사용

    # ── 인증 ──
    # 운영에서는 반드시 긴 무작위 문자열을 사용합니다.
    jwt_secret: str = ""

    @property
    def sqlalchemy_url(self) -> URL:
        return to_sqlalchemy_url(self.database_url)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]  (database_url 은 환경 변수에서 채워짐)
