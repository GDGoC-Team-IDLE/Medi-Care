import { Stack } from 'expo-router';

import { colors, fontSize } from '@/constants/theme';

/** 보호자 화면 묶음 — B 담당. 이 폴더 안의 파일은 /guardian/... 주소가 됩니다. */
export default function GuardianLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitleStyle: { fontSize: fontSize.title, fontWeight: '700' },
        headerTintColor: colors.secondary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: '보호자 홈' }} />
    </Stack>
  );
}
