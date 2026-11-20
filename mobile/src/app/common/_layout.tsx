import { Stack } from 'expo-router';

import { C } from '@/constants/theme';

/** 복용자·보호자 양쪽에서 쓰는 화면 묶음 (로그인, 기기 연결, 달력, 그날의 기록). 이 폴더 안의 파일은 /common/... 주소가 됩니다. */
export default function CommonLayout() {
  // 화면이 Phone(src/components/core.tsx) 틀로 윗줄까지 직접 그리므로 헤더는 쓰지 않습니다.
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 180, contentStyle: { backgroundColor: C.paper } }} />;
}
