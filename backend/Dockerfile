FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# 로컬 테스트용 업로드 폴더 (운영 사진은 Supabase Storage)
RUN mkdir -p /app/uploads

EXPOSE 8000

# Render 는 PORT 환경 변수로 포트를 알려 줍니다. 없으면(로컬 compose) 8000.
# 무료 인스턴스는 메모리가 작아 worker 는 1개로 둡니다. (주기 작업은 앱 안이 아니라 외부 크론이 호출)
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
