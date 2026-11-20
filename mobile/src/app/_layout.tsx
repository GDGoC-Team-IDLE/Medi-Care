import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

export default function RootLayout() {
  // 시작 화면은 헤더 없이, patient/ guardian/ 은 각자 _layout 에서 헤더를 그립니다.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
