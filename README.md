# Medi-Care

어르신 복약 관리 서비스입니다. 처방 등록 → 회차별 복약 알림 → 사진으로 복용 인증 → 보호자 알림 흐름으로 동작합니다.

```text
안드로이드 앱 ─┐
               ├──▶ medi-care-api (Render, FastAPI) ──┬──▶ Neon (PostgreSQL)
웹 브라우저 ───┘          ▲                            └──▶ Supabase Storage (인증 사진)
     │                    │ API 호출
     └──▶ medi-care-web (Render 정적 사이트, Expo 웹 빌드)
```

앱과 웹은 같은 코드(`mobile/`, Expo)로 만듭니다.

지금 저장소에는 기초 설정과 보호자 인증·어르신 기기 연결 API가 들어 있습니다. 나머지 API와 화면은 팀원 각자 명세를 맞춘 뒤 구현합니다.


- **배포:** Render ([render.yaml](render.yaml))
- **로컬 개발:** `docker-compose.yml`과 `nginx/`는 로컬용입니다. DB는 로컬에 띄우지 않고 Neon의 dev 브랜치에 붙습니다.

## 폴더 구조

```text
.
├── render.yaml             # Render Blueprint (API 웹 서비스 + 정적 웹)
├── docker-compose.yml      # 로컬용: backend + nginx (DB 없음, Neon 사용)
├── .env.example            # 환경 변수 템플릿 → .env 로 복사
├── nginx/nginx.conf        # 로컬용: /api/·/docs → backend, 그 외 → mobile/dist
├── backend/
│   ├── Dockerfile          # Python 3.14, PORT 환경 변수로 실행 (기본 8000)
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── app/
│   │   ├── main.py         # 앱 생성, CORS, create_all, 라우터 등록
│   │   ├── core/
│   │   │   ├── config.py   # 환경 변수 (DATABASE_URL, Supabase, CORS, 시간대)
│   │   │   ├── database.py # engine, SessionLocal, Base, get_db
│   │   │   └── clock.py    # now_local() - 서비스 시간대 기준 현재 시각
│   │   ├── enums.py        # Slot, DoseStatus, VerifyResult, AlarmMode, MealTiming
│   │   ├── models.py       # DB 테이블 14개
│   │   ├── security.py     # 비밀번호 해시, JWT, 토큰 해시
│   │   ├── seed.py         # 시연용 데이터
│   │   └── routers/
│   │       ├── auth.py     # 보호자 가입·로그인·토큰·탈퇴
│   │       ├── patients.py # 어르신 등록·기기 연결·기기 인증
│   │       ├── notifications.py # 보호자 푸시 토큰·15분 무응답 알림
│   │       └── health.py   # GET /api/v1/health
│   └── tests/            # SQLite로 smoke 및 인증 전체 흐름 테스트
└── mobile/                 # React Native (Expo) - 안드로이드 앱 + 웹
    ├── app.json            # 웹은 SPA(output: single)로 빌드
    ├── .env.example        # EXPO_PUBLIC_API_URL
    ├── dist/               # 웹 빌드 결과 (커밋 안 함)
    ├── _old/               # 예전 기능 코드 보관 (커밋 안 함, 타입체크·빌드 제외)
    └── src/
        ├── app/            # 화면 (파일 하나 = 화면 하나, 경로 = 주소)
        │   ├── _layout.tsx         # 최상위 Stack
        │   ├── index.tsx           # /          화면 목록 (개발용 첫 화면)
        │   ├── patient/            # /patient/… 복용자 화면 (A 담당)  예: p04-today.tsx
        │   ├── guardian/           # /guardian/… 보호자 화면 (B 담당) 예: g01-today.tsx
        │   └── common/             # /common/…  양쪽에서 쓰는 화면 (로그인, 기기 연결, 달력)
        ├── screens/        # 화면 구현 (app/ 의 파일은 여기 컴포넌트를 내보내기만 함)
        ├── components/     # 공용 컴포넌트 (core · parts · field)
        ├── constants/
        │   ├── theme.ts        # 어르신용 색·글씨·버튼 크기 + 목업 색 토큰 C
        │   └── assets.gen.ts   # 아이콘·삽화 SVG (자동 생성)
        └── lib/
            ├── api.ts      # 공용 API 요청 함수 (get/post/patch/postForm)
            ├── storage.ts  # 토큰 저장 (앱: SecureStore, 웹: localStorage)
            ├── platform.ts # isWeb 등 플랫폼 분기
            ├── medicationNotifications.ts # 예정·5·10·15분 로컬 알림
            ├── notificationEscalation.ts  # 15분 무응답 서버 전송·재시도
            ├── pushRegistration.ts        # 보호자 Expo Push 토큰 등록
            ├── nav.ts      # 화면 id 로 이동 (go / swap / back)
            └── mock.ts     # 서버가 붙기 전까지 쓰는 예시 값
```

## 로컬 실행

### 1. 환경 변수

```bash
cp .env.example .env    # DATABASE_URL 에 Neon dev 브랜치 연결 주소를 넣습니다
```

`DATABASE_URL`은 필수입니다. Neon 콘솔의 **Connect**에서 받은 `postgresql://...?sslmode=require` 주소를 그대로 넣으면 됩니다 (드라이버는 코드에서 psycopg로 바꿉니다).
운영(main) 브랜치가 아니라 **dev 브랜치** 주소를 씁니다.

### 2. 백엔드 (Docker 없이)

Python 3.14 기준입니다 (Dockerfile과 같은 버전).

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt

uvicorn app.main:app --reload          # ../.env 를 읽어 Neon 에 연결 → http://localhost:8000/api/v1/health
                                       # 폰(실기기)에서 붙으려면 --host 0.0.0.0 추가
python -m app.seed                     # 시연용 데이터 (dev 브랜치에만)
pytest                                 # smoke 테스트 (SQLite 로 돌아서 Neon 불필요)
```

### 3. Docker Compose (API + 웹 미리보기)

```bash
(cd mobile && npm install && npm run build:web)    # 웹 빌드 → mobile/dist
docker compose up -d --build
```

- 웹: <http://localhost> / API 문서: <http://localhost/docs>
- nginx가 같은 주소에서 웹과 `/api`를 함께 서비스하므로, 이때는 `EXPO_PUBLIC_API_URL`을 비워 둬도 됩니다.

### 4. 앱 · 웹 (mobile)

```bash
cd mobile
cp .env.example .env       # EXPO_PUBLIC_API_URL 설정
npm install
```

| 용도 | 명령 | `EXPO_PUBLIC_API_URL` |
| --- | --- | --- |
| 앱 개발 | `npx expo start` (`a` 키로 안드로이드) | PC의 LAN IP, 예: `http://192.168.0.10:8000` |
| 웹 개발 | `npx expo start --web` (<http://localhost:8081>) | `http://localhost:8000` (백엔드 `CORS_ORIGINS` 기본값이 8081 허용) |
| 타입 검사 | `npx tsc --noEmit` | |

`EXPO_PUBLIC_API_URL`은 빌드할 때 코드에 그대로 들어갑니다. 값을 바꾸면 개발 서버를 다시 띄우거나 다시 빌드합니다.

### 파일 업로드

운영에서 인증 사진은 **Supabase Storage**(`SUPABASE_BUCKET`, 기본 `dose-photos`)에 저장합니다.
`UPLOAD_DIR`은 **로컬 테스트용**입니다. Render 서버 디스크는 재시작·재배포 때 지워지므로 운영 파일을 저장하면 안 됩니다.

## Render 배포

1. **Neon 연결 주소 준비**: Neon 콘솔에서 운영용(main) 브랜치의 연결 주소(`postgresql://...?sslmode=require`)를 복사합니다.
2. **Supabase 버킷 생성**: Supabase 콘솔 → Storage에서 `dose-photos` 버킷을 **비공개(private)**로 만들고, Project Settings → API에서 Project URL과 `service_role` 키를 확인합니다.
3. **Blueprint 적용**: Render 대시보드 → **New → Blueprint** → 이 저장소를 선택하면 [render.yaml](render.yaml)대로 두 서비스가 만들어집니다.
   - `medi-care-api`: FastAPI (Docker, `/api/v1/health`로 상태 확인)
   - `medi-care-web`: Expo 웹 빌드 정적 사이트 (모든 경로를 `index.html`로 rewrite → `/guardian`에서 새로고침해도 유지)
4. **환경 변수 입력**: 처음 적용할 때 대시보드가 값을 물어봅니다 (`sync: false`).

| 서비스 | 변수 | 값 |
| --- | --- | --- |
| medi-care-api | `DATABASE_URL` | 1번의 Neon 주소 |
| | `CORS_ORIGINS` | 웹 주소, 예: `https://medi-care-web.onrender.com` |
| | `TZ` | `Asia/Seoul` |
| | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_BUCKET` | 2번 값 / `dose-photos` |
| | `GEMINI_API_KEY` / `MFDS_SERVICE_KEY` / `JWT_SECRET` | 각 담당자가 발급한 값 (`JWT_SECRET`은 긴 무작위 문자열) |
| | `CRON_SECRET` | 긴 무작위 문자열 (cron-job.org 에도 같은 값 입력) |
| medi-care-web | `EXPO_PUBLIC_API_URL` | API 주소, 예: `https://medi-care-api.onrender.com` |

웹은 API와 주소가 다르므로 **웹 정적 사이트 환경 변수에 API 주소를 넣고, API의 `CORS_ORIGINS`에 웹 주소를 넣어야** 웹에서 API를 부를 수 있습니다.
`EXPO_PUBLIC_API_URL`은 빌드 때 들어가므로, 값을 바꾼 뒤에는 웹 서비스를 다시 배포합니다.

API 서비스는 `region: singapore`로 만들어집니다 (만든 뒤에는 바꿀 수 없음). Neon 프로젝트도 싱가포르(AWS `ap-southeast-1`)에 두면 API와 DB 사이 지연이 가장 적습니다.
정적 사이트는 CDN으로 서비스되므로 지역 설정이 없습니다.

## 주기 작업 · 알림

- **주기 작업:** 외부 크론(cron-job.org)이 `POST /api/v1/internal/tick`을 `X-Cron-Secret` 헤더와 함께 10분마다 호출합니다 (담당: 안민규).
  엔드포인트는 헤더 값이 `CRON_SECRET`과 같은지 확인하도록 구현합니다. 서버 안에서 도는 스케줄러(APScheduler 등)는 쓰지 않습니다.
- **복용 시간 알림:** 예정 시각과 5·10·15분 뒤 알림은 폰에서 로컬로 예약합니다.
- **보호자 알림:** 15분 알림 시점에만 어르신 앱이 서버에 무응답을 보고합니다. 앱이 종료되어 즉시 전송하지 못한 경우에는 다음 앱 실행 시 재시도하며, 같은 복용 회차의 보호자 알림은 서버에서 한 번만 생성합니다.

## DB 테이블

DB는 PostgreSQL(Neon)이고, 테이블은 앱 시작 시 `create_all`로 만들어집니다.
`create_all`은 **이미 있는 테이블을 바꾸지 않으므로**, 컬럼을 바꾼 뒤에는 Neon dev 브랜치에서 해당 테이블을 지우거나 브랜치를 초기화(Reset from parent)한 뒤 다시 실행합니다.

| 테이블 | 설명 | 주요 컬럼 |
| --- | --- | --- |
| `guardians` | 보호자 (로그인 계정) | `email` UNIQUE, `password_hash` |
| `refresh_tokens` | 보호자 토큰 재발급 | `guardian_id` → guardians, `token_hash` UNIQUE, `expires_at` |
| `revoked_access_tokens` | 로그아웃된 JWT 차단 | PK `token_hash`, `expires_at` |
| `patients` | 어르신 | `guardian_id` → guardians, `device_token` UNIQUE NULL 가능(해시 저장) |
| `pairing_codes` | 어르신 기기 연결용 6자리 코드 | PK `code`, `patient_id` UNIQUE, `expires_at` |
| `pair_attempts` | IP별 기기 연결 시도 | `client_ip`, `attempted_at` |
| `alarm_settings` | 어르신별·회차별 알람 방식 | PK(`patient_id`, `slot`), `mode` 기본 `POPUP` |
| `push_tokens` | 보호자 기기의 Expo 푸시 토큰 | `guardian_id` → guardians, `expo_token` UNIQUE |
| `drug_info` | 식약처 의약품 정보 캐시 | PK `item_seq`(품목기준코드), `normalized_name` INDEX, `dur_json`, `pill_json` |
| `prescriptions` | 처방 1건 | `patient_id`, `start_date`, `days`, `image_path`(NULL 가능), `ai_json` |
| `prescription_drugs` | 처방에 포함된 약 1종 | `item_seq`(NULL 가능) → drug_info, `count_per_dose`, `slots`(JSON 배열), `meal_timing` 기본 `AFTER` |
| `dose_slots` | 날짜별 복용 회차 1건 | UNIQUE(`prescription_id`, `slot_date`, `slot`), INDEX(`patient_id`, `slot_date`), `expected_count`, `status` 기본 `PENDING` |
| `dose_logs` | 복용 인증 사진 1건과 판정 | `dose_slot_id` → dose_slots, `photo_path`, `ai_json`, `result` |
| `guardian_alerts` | 보호자 알림 내역 | UNIQUE(`dose_slot_id`, `type`), `push_sent_at`, `push_error` |

- 열거형 ([app/enums.py](backend/app/enums.py)) 값은 대문자 문자열로 저장됩니다 (DB 타입은 VARCHAR, PostgreSQL ENUM 타입 미사용 → 값 추가 시 ALTER 불필요).
- `*_json`, `slots` 컬럼은 JSONB입니다.

| 열거형 | 값 |
| --- | --- |
| `Slot` | `MORNING` `LUNCH` `DINNER` `BEDTIME` |
| `DoseStatus` | `PENDING` `DONE` `MISSED` `WRONG` |
| `VerifyResult` | `OK` `WRONG_TIME` `ALREADY_TAKEN` `COUNT_MISMATCH` `RETAKE` |
| `AlarmMode` | `POPUP` `FULLSCREEN` |
| `GuardianAlertType` | `DOSE_NO_RESPONSE` |
| `MealTiming` | `BEFORE` `AFTER` `ANY` |

시간은 tz 정보 없이 서비스 시간대(Asia/Seoul) 기준으로 저장합니다. 현재 시각은 `datetime.now()` 대신 `app.core.clock.now_local()`을 씁니다.

## 팀 규칙

### 백엔드

- **경로:** 모든 API는 `/api/v1` 아래에 둡니다. 끝 슬래시는 붙이지 않습니다 (`/api/v1/prescriptions` ○, `/api/v1/prescriptions/` ×).
- **이름:** 경로, JSON 필드, 쿼리 파라미터 모두 snake_case로 씁니다.
- **라우터:** 기능별 라우터는 `backend/app/routers/<분류>.py`로 각자 만들고, [main.py](backend/app/main.py)에서 `app.include_router(<분류>.router, prefix=API_PREFIX)`로 등록합니다.
- **설정 추가:** 기능에 필요한 설정(API 키 등)은 담당자가 [config.py](backend/app/core/config.py)에 추가합니다. 같은 키를 `.env.example`과 [render.yaml](render.yaml)의 `envVars`에도 추가하고, 비밀 값은 비워 둡니다(`sync: false`).
- **DB 세션:** 라우터에서는 `Depends(get_db)`로 받습니다.

### 프론트 (mobile)

- **화면 위치:** 복용자 화면은 `src/app/patient/`(A), 보호자 화면은 `src/app/guardian/`(B)에 만듭니다. 파일 경로가 곧 주소입니다 (`src/app/guardian/prescriptions.tsx` → `/guardian/prescriptions`).
- **공용 컴포넌트:** 두 쪽에서 같이 쓰는 컴포넌트는 `src/components/`에 둡니다. `src/app/` 안에는 화면 파일만 둡니다.
- **API 호출:** 반드시 [src/lib/api.ts](mobile/src/lib/api.ts)의 `api.get / post / patch / postForm`을 씁니다. `fetch`를 직접 부르지 않습니다. 주소(`/api/v1`), 토큰 헤더, 에러 변환(`ApiError`)이 여기서 한 번에 처리됩니다.
- **로그인 토큰:** `saveToken('guardian' | 'device', token)`으로 저장하면 이후 요청에 `Authorization: Bearer` / `X-Device-Token`이 자동으로 붙습니다.
- **패키지 설치:** `npx expo install <패키지>`로만 설치합니다. `npm install <패키지>`는 SDK와 버전이 안 맞을 수 있습니다.
- **웹 분기:** 웹에서 안 되는 기능(푸시 알림 등)은 [src/lib/platform.ts](mobile/src/lib/platform.ts)의 `isWeb`으로 분기합니다. 사용 예시는 파일 안 주석에 있습니다.
- **디자인 값:** 색·글씨 크기·버튼 높이는 [src/constants/theme.ts](mobile/src/constants/theme.ts) 값을 씁니다 (본문 20 이상, 버튼 높이 56 이상, 고대비).
