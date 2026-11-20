import * as Notifications from 'expo-notifications';
import { Stack, router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '@/constants/theme';
import {
  flushDueGuardianEscalations,
  handleGuardianEscalationData,
} from '@/lib/notificationEscalation';
import { initializeMedicationNotifications } from '@/lib/medicationNotifications';
import { registerGuardianPushToken } from '@/lib/pushRegistration';

function openNotificationRoute(data: Record<string, unknown>) {
  const route = typeof data.route === 'string' ? data.route : '/patient/p06-shoot';
  const slotId = Number(data.medicareSlotId);
  const suffix = Number.isInteger(slotId) ? `?slot_id=${slotId}` : '';
  router.push(`${route}${suffix}` as Href);
}

export default function Layout() {
  useEffect(() => {
    void initializeMedicationNotifications();
    void flushDueGuardianEscalations();
    void registerGuardianPushToken().catch(() => undefined);

    const received = Notifications.addNotificationReceivedListener((notification) => {
      void handleGuardianEscalationData(notification.request.content.data ?? {});
    });
    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data ?? {};
      void handleGuardianEscalationData(data);
      openNotificationRoute(data);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void flushDueGuardianEscalations();
        void registerGuardianPushToken().catch(() => undefined);
      }
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openNotificationRoute(response.notification.request.content.data ?? {});
    });

    return () => {
      received.remove();
      responded.remove();
      appState.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      {/* 화면마다 글·버튼 자리가 같아서 밀기보다 겹쳐 바뀌는 쪽이 덜 흔들린다. 내용이 올라오는 움직임은 Phone 이 한다. */}
      <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 180, contentStyle: { backgroundColor: C.paper } }} />
    </SafeAreaProvider>
  );
}
