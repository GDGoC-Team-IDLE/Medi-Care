import * as SecureStore from 'expo-secure-store';

import { isWeb } from './platform';

/**
 * 토큰 같은 작은 문자열 저장소.
 * - 앱: expo-secure-store (기기 암호화 저장소)
 * - 웹: localStorage (암호화되지 않음)
 *
 * 키에는 영문·숫자·`.`·`-`·`_` 만 씁니다 (SecureStore 제약).
 */

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // 사생활 보호 모드 등으로 localStorage 를 못 쓰는 경우
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 저장 실패는 무시합니다 (다음 로그인 때 다시 받음)
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.removeItem(key);
    } catch {
      // 무시
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
