import { Stack } from 'expo-router';

import { C } from '@/constants/theme';

/** 보호자 화면 묶음 — B 담당. 이 폴더 안의 파일은 /guardian/... 주소가 됩니다. */
export default function GuardianLayout() {
  // 화면이 Phone(src/components/core.tsx) 틀로 윗줄까지 직접 그리므로 헤더는 쓰지 않습니다.
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 180, contentStyle: { backgroundColor: C.paper } }} />;
}
