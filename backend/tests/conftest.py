import os
import tempfile

# 테스트는 PostgreSQL 없이 임시 SQLite 파일로 돌립니다. app 을 import 하기 전에 설정해야 합니다.
# (메모리 SQLite 는 스레드마다 다른 DB 가 돼서 TestClient 와 함께 쓸 수 없습니다)
_tmp = tempfile.mkdtemp(prefix="medicare-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["JWT_SECRET"] = "test-secret-key-for-unit-testing-1234567890"
