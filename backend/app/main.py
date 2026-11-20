from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (create_all 전에 테이블을 등록하기 위해 import)
from app.core.config import get_settings
from app.core.database import Base, engine

import importlib
import pkgutil

from app import routers

# from app.routers import auth
# from app.routers import dose_status
# from app.routers import health
# from app.routers import notifications
# from app.routers import patients
# # from app.routers import auth, health, notifications, patients
# # from app.routers import auth, dose_status, health, patients, verifications
API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # TODO: 스키마가 자리 잡으면 Alembic 마이그레이션으로 바꿉니다.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=get_settings().app_name, lifespan=lifespan)

# 개발 중 expo start --web(다른 포트)에서 API 를 부를 수 있게 허용합니다.
# 인증은 쿠키가 아니라 헤더(Authorization, X-Device-Token)라서 allow_credentials 는 끕니다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

# routers/ 폴더의 .py 파일 중 router 변수가 있는 것을 전부 자동 등록합니다.
# 새 기능은 routers/<이름>.py 에 router = APIRouter(...) 만 만들면 되고, 이 파일은 고치지 않습니다.
for module_info in sorted(pkgutil.iter_modules(routers.__path__), key=lambda m: m.name):
    module = importlib.import_module(f"{routers.__name__}.{module_info.name}")
    router = getattr(module, "router", None)
    if router is not None:
        app.include_router(router, prefix=API_PREFIX)
