import { Stack } from 'expo-router';

import { C } from '@/constants/theme';

/** 복용자(어르신) 화면 묶음 — A 담당. 이 폴더 안의 파일은 /patient/... 주소가 됩니다. */
export default function PatientLayout() {
  // 화면이 Phone(src/components/core.tsx) 틀로 윗줄까지 직접 그리므로 헤더는 쓰지 않습니다.
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 180, contentStyle: { backgroundColor: C.paper } }} />;
}
