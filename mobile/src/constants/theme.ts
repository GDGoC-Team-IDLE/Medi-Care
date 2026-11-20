/**
 * 어르신용 기본 테마. 큰 글씨, 큰 터치 영역, 고대비 색을 기본값으로 둡니다.
 * 화면을 만들 때 숫자·색을 직접 쓰지 말고 여기 값을 가져다 씁니다.
 */

/** 색. 글자색·버튼색은 흰 배경 대비 7:1 이상 (WCAG AAA) */
export const colors = {
  background: '#FFFFFF',
  surface: '#F2F2F2', // 카드 등 구분 배경
  text: '#111111',
  textMuted: '#3D3D3D', // 보조 글씨도 흐리게 하지 않습니다
  border: '#5A5A5A',
  primary: '#0A5C36', // 복용자 (진한 초록)
  secondary: '#0B3D91', // 보호자 (진한 파랑)
  danger: '#B00020',
  onPrimary: '#FFFFFF', // primary / secondary / danger 위의 글씨
} as const;

/** 글씨 크기. 본문은 20 이상 */
export const fontSize = {
  caption: 18,
  body: 20,
  button: 22,
  title: 28,
  display: 34,
} as const;

/** 크기. 버튼·터치 영역은 높이 56 이상 */
export const sizes = {
  buttonHeight: 64,
  minTouch: 56,
  radius: 12,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const theme = { colors, fontSize, sizes, spacing } as const;

/**
 * 목업 5판(design/mockup)의 디자인 토큰. 목업을 옮긴 화면(src/screens)과 부품(src/components)이 씁니다.
 */
export const C = {
  paper: '#FAFAFA',
  ink: '#171717',
  ink2: '#555555',
  line: '#DADADA',
  tint: '#F0F0F0',
  plan: '#737373',
  track: '#858585',
  sun: '#FFC421',
  ok: '#0E5F35',
  miss: '#C2570A',
  misst: '#B8500A',
  wrong: '#B3123B',
  night: '#121212',
  nightt: '#BDBDBD',
  cam: '#111111',
  white: '#FFFFFF',
} as const;

/** 목업 기준 화면 크기. 좌표는 이 크기 위의 값이고 Phone(src/components/core.tsx)이 기기에 맞춰 늘립니다. */
export const W = 390;
export const H = 844;
