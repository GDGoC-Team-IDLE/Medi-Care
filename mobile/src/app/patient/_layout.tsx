import { Stack } from 'expo-router';

import { colors, fontSize } from '@/constants/theme';

/** 복용자(어르신) 화면 묶음 — A 담당. 이 폴더 안의 파일은 /patient/... 주소가 됩니다. */
export default function PatientLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitleStyle: { fontSize: fontSize.title, fontWeight: '700' },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: '복용자 홈' }} />
    </Stack>
  );
}
