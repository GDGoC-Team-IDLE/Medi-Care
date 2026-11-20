# Medi-Care 모바일 (React Native · Expo)

UI 목업 5판의 화면 63개를 React Native 로 옮긴 **눌러 보는 목업**입니다. 서버는 아직 붙지 않았고 값은 `src/lib/mock.ts` 의 예시입니다.
실행 방법과 팀 규칙은 [루트 README](../README.md) 를 따릅니다.

```bash
cp .env.example .env
npm install
npx expo start          # w 키: 웹, a 키: 안드로이드
npm run typecheck
npm run lint
```

## 구조

| 위치 | 내용 |
| --- | --- |
| `src/app/index.tsx` | `/` 화면 목록 (개발용 첫 화면) |
| `src/app/patient/` | 복용자 화면 `p..` → `/patient/p04-today` |
| `src/app/guardian/` | 보호자 화면 `g..` → `/guardian/g01-today` |
| `src/app/common/` | 양쪽에서 쓰는 화면 `c..` (로그인, 기기 연결, 달력, 그날의 기록) → `/common/c01-login` |
| `src/screens/` | 화면 구현. `src/app` 의 파일은 여기 컴포넌트를 내보내기만 합니다. `index.ts` 가 흐름별 목록 |
| `src/components/` | 공용 부품. `core.tsx` 의 `Phone` 이 390×844 목업 좌표를 기기 크기에 맞춰 늘립니다 |
| `src/constants/theme.ts` | 팀 기본 테마 + 목업 색 토큰 `C` |
| `src/constants/assets.gen.ts` | 아이콘·삽화 SVG (자동 생성, `npm run assets -- <design/assets 경로>`) |
| `src/lib/nav.ts` | `go('p04-today')` 처럼 화면 id 로 이동 |
| `src/lib/mock.ts` | 예시 값. API 가 생기면 `src/lib/api.ts` 호출로 바꿉니다 |

화면 id 는 목업의 `data-screen` 값과 같고, 첫 글자가 폴더를 정합니다 (`p` 복용자 · `g` 보호자 · `c` 공용).

## 아직 없는 것

실제 카메라(지금은 예시 사진), 로컬 알림·잠금화면 알람, API 호출, 로그인 상태에 따른 첫 화면 분기.
웹으로만 확인했고 실제 Android 기기에서는 확인하지 않았습니다.
