import { Redirect } from 'expo-router';

/** /guardian → 보호자 첫 화면 (오늘 현황) */
export default function GuardianHome() {
  return <Redirect href="/guardian/g01-today" />;
}
