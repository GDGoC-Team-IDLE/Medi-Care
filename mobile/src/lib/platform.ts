import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';
export const isNative = !isWeb;
export const isAndroid = Platform.OS === 'android';
export const isIOS = Platform.OS === 'ios';

/*
 * 앱 전용 기능(푸시 알림, SecureStore 등)은 웹에서 호출하지 않게 가드합니다.
 *
 *   import * as Notifications from 'expo-notifications';
 *   import { isWeb } from '@/lib/platform';
 *
 *   export async function registerPush(): Promise<string | null> {
 *     if (isWeb) return null; // 웹은 푸시 미지원 → 조용히 건너뜀
 *     const { status } = await Notifications.requestPermissionsAsync();
 *     ...
 *   }
 *
 * 화면이나 컴포넌트를 통째로 다르게 만들어야 하면 파일 확장자로 나눌 수 있습니다.
 *   Camera.tsx      ← 앱
 *   Camera.web.tsx  ← 웹
 *   import Camera from '@/components/Camera'  → 플랫폼에 맞는 파일이 자동으로 선택됩니다.
 */
