import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { TOKEN_KEYS, api } from './api';
import { initializeMedicationNotifications } from './medicationNotifications';
import { isWeb } from './platform';
import { getItem } from './storage';

/** 보호자 로그인 토큰을 저장한 뒤 호출합니다. 웹과 projectId가 없는 개발 환경은 건너뜁니다. */
export async function registerGuardianPushToken(): Promise<string | null> {
  if (isWeb) return null;
  if (!(await getItem(TOKEN_KEYS.guardian))) return null;
  await initializeMedicationNotifications();

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== 'granted') return null;

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.post('/push-tokens', { expo_token: token });
  return token;
}
