import { useEffect, useSyncExternalStore } from 'react';

import { getItem, removeItem, setItem } from './storage';

/**
 * 보호자 폰에서 지금 보고 있는 어르신 (마이페이지 → 어르신 고르기 g22 의 '선택').
 * - 보호자 현황 머리줄의 이름 · 달력, 약봉투 등록(register.tsx 의 owner)이 이 어르신을 쓴다.
 * - 앱을 다시 켜도 남도록 저장소에 둔다. 고른 적이 없으면 null (그때는 첫 어르신).
 */
export type CurrentPatient = { patient_id: number; name: string };

const KEY = 'medicare.current_patient';
let current: CurrentPatient | null | undefined; // undefined = 아직 저장소에서 안 읽음
let loading: Promise<CurrentPatient | null> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function loadCurrentPatient(): Promise<CurrentPatient | null> {
  if (current !== undefined) return Promise.resolve(current);
  loading ??= getItem(KEY).then((v) => {
    try {
      current = v ? (JSON.parse(v) as CurrentPatient) : null;
    } catch {
      current = null;
    }
    emit();
    return current;
  });
  return loading;
}

export async function setCurrentPatient(p: CurrentPatient | null) {
  current = p;
  emit();
  await (p ? setItem(KEY, JSON.stringify(p)) : removeItem(KEY));
}

/** 화면에서 쓰는 지금 어르신. 저장소를 읽기 전엔 null */
export function useCurrentPatient(): CurrentPatient | null {
  const v = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current ?? null,
  );
  useEffect(() => {
    void loadCurrentPatient();
  }, []);
  return v;
}
