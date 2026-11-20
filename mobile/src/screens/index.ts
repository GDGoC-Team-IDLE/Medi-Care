// 화면 목록. id 는 목업(design/mockup)의 data-screen 값과 같고, 주소는 src/app/<patient|guardian|common>/<id>.tsx 이다.
import type { ComponentType } from 'react';
import * as A from './account';
import * as R from './register';
import * as T from './today';
import * as D from './dose';
import * as G from './guardian';

export type ScreenDef = { id: string; title: string; C: ComponentType };
export type Flow = { name: string; screens: ScreenDef[] };

const s = (id: string, title: string, C: ComponentType): ScreenDef => ({ id, title, C });

export const FLOWS: Flow[] = [
  {
    name: '계정',
    screens: [s('c01-login', '보호자 로그인', A.Login), s('c02-device', '누구 폰인가요?', A.Device), s('c03-patient', '어르신 이름', A.Patient), s('c04-linked', '연결됐어요', A.Linked), s('c05-notify', '알림 켜기', A.Notify)],
  },
  {
    name: '연결 숫자 (별안)',
    screens: [s('g04-code', '연결 숫자 보기', A.Code), s('c06-pad', '연결 숫자 넣기', A.Pad), s('c07-codebad', '숫자가 달라요', A.CodeBad)],
  },
  {
    name: '약봉투 등록',
    screens: [s('p01-scan', '약봉투 찍기', R.Scan), s('p12-reading', '읽는 중', R.Reading), s('p23-review', '회차 확인', R.Review), s('p03-caution', '주의사항', R.CautionScreen), s('p28-start', '일정 시작', R.Start)],
  },
  {
    name: '고치기',
    screens: [s('p23b-slot', '회차의 약 목록', R.SlotDrugs), s('p25-drug', '약 하나 고치기', R.Drug), s('p25d-days', '복용 일수', R.Days)],
  },
  {
    name: '오늘',
    screens: [s('p21-empty', '약 없음', T.Empty), s('p04-today', '지금 먹을 약', T.Today), s('p19-wait', '다음 회차 대기', T.Wait), s('p20-missed', '기록 없음', T.Missed), s('p16-flagged', '1알 부족', T.Flagged)],
  },
  {
    name: '기록',
    screens: [s('p27-didtake', '오늘 약', T.DidTake), s('p33-days', '지난 날', T.PastDays), s('c09-day', '그날의 기록', T.Day)],
  },
  {
    name: '알림',
    screens: [s('p17-notice', '일반 알림', D.Notice), s('p17b-again', '다시 알림', D.NoticeAgain), s('p05-alarm', '잠금화면 알람', D.Alarm), s('p05b-loud', '큰 소리 알람', D.AlarmLoud), s('p32-nomed', '약이 없어요', D.NoMed)],
  },
  {
    name: '인증 촬영',
    screens: [s('p30-before', '이미 드신 약', D.Before), s('p06-shoot', '촬영', D.Shoot), s('p06b-dark', '어두움', D.ShootDark), s('p18-checking', '보는 중', D.Checking)],
  },
  {
    name: '판정',
    screens: [s('p07-ok', '맞아요', D.Ok), s('p08-wrongtime', '다른 회차 약', D.WrongTime), s('p09-already', '이미 드셨어요', D.Already), s('p10-count', '개수 다름', D.Count), s('p11-retake', '다시 찍기', D.Retake)],
  },
  {
    name: '실패 · 연결 없음',
    screens: [s('p13-noread', '글씨가 안 보여요', D.NoRead), s('p22-unsure', '보호자와 같이', D.Unsure), s('p15-offline', '인터넷 없음', D.Offline), s('p15t-slow', '오래 걸려요', D.Slow)],
  },
  {
    name: '기기 권한',
    screens: [s('p14-nocam', '카메라 꺼짐', D.NoCam), s('p26-belloff', '알림 꺼짐', T.BellOff), s('p34-alarmnew', '알림이 바뀌어요', D.AlarmNew)],
  },
  {
    name: '보호자 · 미복용',
    screens: [s('g10-lockmiss', '미복용 알림', G.LockMiss), s('g02-missed', '미복용 사건', G.MissedEvent), s('g12-after', '확인 뒤 현황', G.GAfter), s('g15-resolved', '해결 알림', G.LockResolved)],
  },
  {
    name: '보호자 · 오복용',
    screens: [s('g11-lockwrong', '오복용 알림 (개수)', G.LockWrong), s('g11t-locktime', '오복용 알림 (다른 회차)', G.LockWrongTime), s('g11a-lockagain', '오복용 알림 (또 찍음)', G.LockAgain), s('g03-wrong', '오복용 사건', G.WrongEvent), s('g19-afterwrong', '확인 뒤 현황 (오복용)', G.GAfterWrong), s('g11c-nomed', '약 없음 알림', G.LockNoMed), s('g18-afternomed', '확인 뒤 현황 (약 없음)', G.GAfterNoMed)],
  },
  {
    name: '안부 신호',
    screens: [s('g13-lockwell', '안부 알림', G.LockWell), s('g14-well', '안부 확인', G.WellEvent), s('g17-afterwell', '확인 뒤 현황 (안부)', G.GAfterWell)],
  },
  {
    name: '보호자 현황',
    screens: [s('g01-today', '오늘 현황', G.GToday), s('c08-calendar', '달력', G.Calendar), s('g08-empty', '약 없음', G.GEmpty), s('g16-alarmset', '알림 방식', G.AlarmSet)],
  },
];
