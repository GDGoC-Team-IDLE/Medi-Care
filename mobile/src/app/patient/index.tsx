import { Redirect } from 'expo-router';

/** /patient → 복용자 첫 화면 (지금 먹을 약) */
export default function PatientHome() {
  return <Redirect href="/patient/p04-today" />;
}
