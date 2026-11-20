import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '@/constants/theme';

export default function Layout() {
  return (
    <SafeAreaProvider>
      {/* 화면마다 글·버튼 자리가 같아서 밀기보다 겹쳐 바뀌는 쪽이 덜 흔들린다. 내용이 올라오는 움직임은 Phone 이 한다. */}
      <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 180, contentStyle: { backgroundColor: C.paper } }} />
    </SafeAreaProvider>
  );
}
