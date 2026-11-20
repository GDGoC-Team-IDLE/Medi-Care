// 서버가 붙기 전까지 쓰는 예시 값. API 가 생기면 이 파일을 호출로 바꾼다.
import { Linking } from 'react-native';

export const PATIENT = '어머니';
export const TODAY = '11월 20일';
export const TODAY_LONG = '11월 20일 금요일';
export const GUARDIAN_TEL = '01000000000';
export const LINK_CODE = '482916';

export const call = () => {
  Linking.openURL(`tel:${GUARDIAN_TEL}`).catch(() => {});
};
