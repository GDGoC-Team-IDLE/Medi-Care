import { router, type Href } from 'expo-router';

/**
 * 화면 id(목업의 data-screen 값, 예: p04-today)로 이동합니다.
 * id 첫 글자가 폴더를 정합니다: p → /patient, g → /guardian, c → /common.
 */
const GROUP: Record<string, string> = { p: 'patient', g: 'guardian', c: 'common' };

export const hrefOf = (id: string) => `/${GROUP[id[0]] ?? 'common'}/${id}` as Href;
export const go = (id: string) => router.push(hrefOf(id));
export const swap = (id: string) => router.replace(hrefOf(id));
export const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
