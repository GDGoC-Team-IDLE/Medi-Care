// 보호자: 잠금 알림 → 사건 → 현황 · 달력 · 화면 가득 알림
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Image, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { go, swap } from '@/lib/nav';
import { api, ApiError } from '@/lib/api';
import { PATIENT, TODAY, call } from '@/lib/mock';
import { C, R } from '@/constants/theme';
import { PNG, type PngFile } from '@/constants/img.gen';
import { Icon, Ill, Phone, Pop, StatusMark, T, Tap, Up, abs, type IconName, type IllName, type Status } from '@/components/core';
import { Back, Blink, Lock, Noti, Tray, type RowSlot, type Slot } from '@/components/parts';

/* ── 잠금 화면 알림 (한 장에 한 건, 리퀴드 글래스) ── */
function LockScreen({ time, children }: { time: string; children: ReactNode }) {
  return (
    <Phone bg={C.lock} fg={C.white}>
      <Lock time={time}>{children}</Lock>
    </Phone>
  );
}
type Row3 = { s: RowSlot[]; f: number; x?: [number, Status] };
const ROW = (s: string, f: number, x?: [number, Status]): Row3 => ({ s: s.split(',') as RowSlot[], f, x });

/** 큰 그림 48 안의 판정 그림(PNG 조각을 목업 viewBox 그대로 잘라 넣는다) */
function LiImg({ vb, parts }: { vb: [number, number, number, number]; parts: [PngFile, number, number, number, number][] }) {
  const s = Math.min(40 / vb[2], 40 / vb[3]);
  const ox = (40 - vb[2] * s) / 2;
  const oy = (40 - vb[3] * s) / 2;
  return (
    <View style={{ width: 40, height: 40 }}>
      {parts.map(([f, x, y, w, h]) => (
        <Image key={f} source={PNG[f]} resizeMode="stretch" style={{ position: 'absolute', left: ox + (x - vb[0]) * s, top: oy + (y - vb[1]) * s, width: w * s, height: h * s }} />
      ))}
    </View>
  );
}
/** 큰 그림: 화살표(p08 판정 그림의 화살표만) */
function LiArrow() {
  return (
    <Svg width={40} height={40} viewBox="176 16 112 84">
      <Path d="M272 88C268 40 228 22 190 52M195.49 40.22L190 52L203 51.77" stroke="#17150F" strokeWidth={3 * (112 / 40)} strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** g10 미복용 */
export function LockMiss() {
  return (
    <LockScreen time="12:45">
      <Noti big={<Icon name="bell" />} title={`${PATIENT} · 점심 응답 없음`} body="15분째 응답이 없어요" row={ROW('done,missed,plan', 1)} onPress={() => swap('g02-missed')} onAck={() => swap('g12-after')} onCall={call} />
    </LockScreen>
  );
}
/** g15 해결 알림: 보낸 알림은 못 고치므로 새 알림 1건. 행동 없음, 누르면 g01 */
export function LockResolved() {
  return (
    <LockScreen time="1:10">
      <Noti big={<StatusMark s="done" size={40} />} title={`${PATIENT} · 점심 1:10 완료`} body="사진으로 확인했어요" row={ROW('done,done,plan', 1)} onPress={() => swap('g01-today')} />
    </LockScreen>
  );
}
/** g11 오복용(개수). 낱말은 사건 g03·허브 p16 과 같은 '1알 부족'. 큰 그림 = 빈 알약 자리 */
export function LockWrong() {
  return (
    <LockScreen time="12:31">
      <Noti big={<Ill name="pill-slot-round" w={40} />} title={`${PATIENT} · 점심 1알 부족`} body="드시기 전에 알려 드렸어요" row={ROW('done,wrong,plan', 1)} onPress={() => swap('g03-wrong')} onAck={() => swap('g19-afterwrong')} onCall={call} />
    </LockScreen>
  );
}
/** g11t 오복용(다른 회차 약). 둘째 줄이 '삼켰나'에 답한다. 큰 그림 = 화살표 */
export function LockWrongTime() {
  return (
    <LockScreen time="12:31">
      <Noti big={<LiArrow />} title={`${PATIENT} · 점심에 저녁 약`} body="드시기 전에 알려 드렸어요" row={ROW('done,wrong,plan', 1)} onPress={() => swap('g03t-wrongtime')} onAck={() => swap('g01-today')} onCall={call} />
    </LockScreen>
  );
}
/** g11a 오복용(이미 먹은 아침 봉투를 또 찍음). 회차 줄: 점심 = 지금(예정), 아침 = 체크 + 세모 배지. 큰 그림 = 뜯긴 봉투 */
export function LockAgain() {
  return (
    <LockScreen time="12:58">
      <Noti
        big={<LiImg vb={[62, 10, 204, 230]} parts={[['verdict-already@307-0.png', 100, 16.6667, 160.333, 58], ['verdict-already@307-1.png', 69, 88, 189.667, 145.667]]} />}
        title={`${PATIENT} · 이미 드신 아침 약`}
        body="드시기 전에 알려 드렸어요"
        row={ROW('done,plan,plan', 1, [0, 'wrong'])}
        onPress={() => swap('g03a-again')}
        onAck={() => swap('g01-today')}
        onCall={call}
      />
    </LockScreen>
  );
}
/** g11c 알람의 '약 없어요'. 약 없음 = 미복용과 같은 마름모. 큰 그림 = 빈 약포 */
export function LockNoMed() {
  return (
    <LockScreen time="12:31">
      <Noti
        big={<LiImg vb={[4, 22, 152, 126]} parts={[['pouch-open@240-0.png', 6.75, 29.75, 146.5, 111.5]]} />}
        title={`${PATIENT} · 점심 약 없음`}
        body="알람에서 '약 없어요'를 누르셨어요"
        row={ROW('done,nomed,plan', 1)}
        onPress={() => swap('g18-afternomed')}
        onAck={() => swap('g18-afternomed')}
        onCall={call}
      />
    </LockScreen>
  );
}
/** g13 안부 신호: 두 회차 연속 미인증이면 1번만. 응급 판단 기능 아님 */
export function LockWell() {
  return (
    <LockScreen time="20:00">
      <Noti big={<Icon name="bell" />} title={`${PATIENT} · 점심·저녁 응답 없음`} body="안부를 확인해 주세요" row={ROW('done,missed,missed', 2)} onPress={() => swap('g14-well')} onAck={() => swap('g17-afterwell')} onCall={call} />
    </LockScreen>
  );
}

/* ── 사건 화면 ── */
function Event({ status, title, at, when = TODAY, warn, ack, children }: { status: Status; title: string; at?: string; when?: string; warn?: boolean; ack: string; children: ReactNode }) {
  return (
    <Phone>
      {/* 사건을 닫고 현황으로. '확인'과 달리 확인 표시는 남기지 않는다 */}
      <Back top={50} onPress={() => swap('g01-today')} />
      <View style={[abs({ left: 56, right: 28, top: 64, height: 32 }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <T s={20} k>
          {PATIENT}
        </T>
        <T s={16} c={C.ink2}>
          {when}
        </T>
      </View>
      <View style={[abs({ left: 28, right: 28, top: 112, height: 48 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <StatusMark s={status} size={32} />
        <T h c={warn ? C.misst : undefined} style={{ flex: 1, letterSpacing: -0.02 * 40 }}>
          {title}
        </T>
        {at && (
          <T s={20} c={C.ink2}>
            {at}
          </T>
        )}
      </View>
      {children}
      <GBtn top={666} icon="phone" label={`${PATIENT}께 전화하기`} onPress={call} />
      <Tap onPress={() => swap(ack)} style={[abs({ left: 28, right: 28, top: 738, height: 56 }), { alignItems: 'center', justifyContent: 'center' }]}>
        <T s={20} k>
          확인
        </T>
      </Tap>
    </Phone>
  );
}

function GBtn({ top, icon, label, onPress }: { top: number; icon: IconName; label: string; onPress?: () => void }) {
  return (
    <Tap
      onPress={onPress}
      style={[abs({ left: 28, right: 28, top, height: 64 }), { borderRadius: R.m, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
    >
      <Icon name={icon} size={24} c={C.paper} />
      <T s={20} k c={C.paper}>
        {label}
      </T>
    </Tap>
  );
}

/** 단계 목록: 마지막 줄이 지금 */
function Steps({ rows }: { rows: { icon?: IconName; status?: Status; name: string; note: string }[] }) {
  return (
    <View style={abs({ left: 28, right: 28, top: 184 })}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        const c = last ? C.ink : C.ink2;
        return (
          <View key={r.name} style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* 위 제목 줄의 상태 기호(32)와 가운데를 맞춘다 */}
            <View style={{ width: 32, alignItems: 'center' }}>{r.icon ? <Icon name={r.icon} size={24} c={c} /> : <StatusMark s={r.status!} size={24} />}</View>
            <T s={20} k style={{ width: 88 }}>
              {r.name}
            </T>
            <T s={16} k={last} c={c}>
              {r.note}
            </T>
          </View>
        );
      })}
    </View>
  );
}

/** 사진(왼쪽 180×240) · 옆 설명(알약 그림 · 굵은 두 줄 · '드시기 전 사진') · 아래 줄(다음 촬영 결과로 바뀜) */
function Evidence({ photo, pills, missAt, text, line, lineIcon }: { photo: ReactNode; pills: IllName[]; missAt?: number; text: string; line: string; lineIcon: IconName }) {
  return (
    <>
      <Up delay={0}>
        <View style={abs({ left: 28, top: 184, width: 180, height: 240 })}>{photo}</View>
      </Up>
      <View style={[abs({ left: 224, right: 28, top: 184 }), { gap: 8 }]}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {pills.map((p, i) => (
            <Pop key={i} delay={250 + i * 90}>
              {i === missAt ? (
                <Blink times={3} delay={0.9}>
                  <Ill name={p} w={48} />
                </Blink>
              ) : (
                <Ill name={p} w={48} />
              )}
            </Pop>
          ))}
        </View>
        <T s={20} k lh={1.2}>
          {text}
        </T>
        <T s={16} c={C.ink2}>
          드시기 전 사진
        </T>
      </View>
      <View style={[abs({ left: 28, right: 28, top: 440, height: 44 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Icon name={lineIcon} size={24} />
        <T s={20} k>
          {line}
        </T>
      </View>
    </>
  );
}

/** g02 미복용 사건. 단계는 예정 + 규칙(5분·15분)으로 계산한 값 */
export function MissedEvent() {
  return (
    <Event status="missed" warn title="점심 응답 없음" at="15분" ack="g12-after">
      <Steps
        rows={[
          { icon: 'bell', name: '알림', note: '응답 없음' },
          { icon: 'volume-2', name: '큰 소리', note: '5분 · 응답 없음' },
          { icon: 'phone', name: '나에게', note: '15분 · 지금' },
        ]}
      />
    </Event>
  );
}

/** g03 오복용 사건(개수). 사진 아래 줄은 다음 촬영 결과로 바뀐다: '다시 찍는 중' → '1:02 완료' */
export function WrongEvent() {
  return (
    <Event status="wrong" title="점심 1알 부족" at="12:31" ack="g19-afterwrong">
      <Evidence photo={<Ill name="photo-palm-noon-1" w={180} h={240} />} pills={['pill-capsule', 'pill-slot-round']} missAt={1} text={'사진 1알\n드실 약 2알'} line="다시 찍는 중" lineIcon="camera" />
    </Event>
  );
}

/** g03t 오복용 사건(다른 회차 약). 저녁 봉투 인증 사진 에셋이 없어 저녁 약포 그림으로 대신(목업과 같음) */
export function WrongTimeEvent() {
  return (
    <Event status="wrong" title="점심에 저녁 약" when={`${TODAY} 12:31`} ack="g01-today">
      <Evidence photo={<Ill name="pouch-evening" w={180} h={180} style={{ marginTop: 30 }} />} pills={['pouch-evening', 'pouch-noon']} text={'찍은 봉투 저녁\n지금 점심'} line="점심은 예정 그대로" lineIcon="sun" />
    </Event>
  );
}

/** g03a 오복용 사건(이미 드신 아침 약을 또 찍음) */
export function AgainEvent() {
  return (
    <Event status="wrong" title="이미 드신 아침 약" when={`${TODAY} 12:58`} ack="g01-today">
      <Evidence photo={<Ill name="photo-palm-morning" w={180} h={240} />} pills={['pouch-morning']} text={'찍은 봉투 아침\n8:12 완료'} line="점심은 예정 그대로" lineIcon="sun" />
    </Event>
  );
}

/** g14 안부 확인. 응급 판단 기능이 아니다 */
export function WellEvent() {
  return (
    <Event status="missed" warn title="안부 확인" at="20:00" ack="g17-afterwell">
      <Steps
        rows={[
          { status: 'missed', name: '점심', note: '응답 없음' },
          { status: 'missed', name: '저녁', note: '응답 없음' },
        ]}
      />
      <T s={20} k left={28} right={28} top={336}>
        약 알림에 두 번 연속 응답이 없어요
      </T>
    </Event>
  );
}

/* ── 현황 ── */
function Head() {
  // 아이콘 셋(달력 · 화면 가득 알림 · 마이페이지)이 들어가도 날짜가 꺾이지 않게 단추 폭 44, 날짜는 한 줄
  const btn = { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={[abs({ left: 28, right: 12, top: 62, height: 48 }), { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
      <T h>{PATIENT}</T>
      <T s={16} fit={96} c={C.ink2} style={{ flex: 1, marginLeft: 8 }}>
        {TODAY}
      </T>
      <Tap accessibilityLabel="달력" onPress={() => go('c08-calendar')} style={btn}>
        <Icon name="calendar-days" size={24} />
      </Tap>
      <Tap accessibilityLabel="화면 가득 알림" onPress={() => go('g16-alarmset')} style={btn}>
        <Icon name="settings" size={24} />
      </Tap>
      <Tap accessibilityLabel="마이페이지" onPress={() => go('g20-mypage')} style={btn}>
        <Icon name="user" size={24} />
      </Tap>
    </View>
  );
}

type DoseRow = { status: Status; name: string; note: string; warn?: boolean; photo?: IllName };
/** 현황: 작은 약통 칸 · 가운데 낱말('문제 있나'의 답) · 센 수 · 회차 목록. 칸이 뜬 뒤 글·목록이 올라온다 */
function Overview({ slots, now, sum, warn, note, rows }: { slots: Slot[]; now: number; sum: string; warn?: boolean; note: string; rows: DoseRow[] }) {
  return (
    <Phone>
      <Head />
      <Tray small slots={slots} now={now} />
      <Up delay={0.6}>
        <T h c={warn ? C.misst : undefined} center top={292}>
          {sum}
        </T>
      </Up>
      <Up delay={0.7}>
        <T s={20} c={C.ink2} center top={344}>
          {note}
        </T>
      </Up>
      <Up delay={0.8}>
        <View style={abs({ left: 0, right: 0, top: 392 })}>
          {rows.map((r) => (
            <View key={r.name} style={{ height: 96, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <StatusMark s={r.status} size={40} />
              <View style={{ flex: 1 }}>
                <T s={20} k c={r.warn ? C.misst : undefined}>
                  {r.name}
                </T>
                <T s={16} c={C.ink2}>
                  {r.note}
                </T>
              </View>
              {r.photo ? (
                <Tap accessibilityLabel={`${r.name} 사진`}>
                  <View style={{ borderRadius: R.s, overflow: 'hidden' }}>
                    <Ill name={r.photo} w={60} h={80} />
                  </View>
                </Tap>
              ) : (
                <View style={{ width: 60 }} />
              )}
            </View>
          ))}
        </View>
      </Up>
    </Phone>
  );
}
const MORNING: DoseRow = { status: 'done', name: '아침', note: '8:12 완료', photo: 'photo-palm-morning' };
const EVENING: DoseRow = { status: 'planned', name: '저녁', note: '예정' };

/** g01 보호자 현황. GET 오늘 회차별 상태 · 인증 시각 · 인증 사진 */
export function GToday() {
  return <Overview slots={['done', 'done', 'plan']} now={0.62} sum="문제 없음" note="2/3 완료 · 다음 저녁" rows={[MORNING, { status: 'done', name: '점심', note: '12:31 완료', photo: 'photo-palm-noon-2' }, EVENING]} />;
}

/** g12 사건 확인 뒤 현황. 미복용 행이 남는다 */
export function GAfter() {
  return <Overview slots={['done', 'missed', 'plan']} now={0.46} warn sum="응답 없음" note="점심 · 오늘 1/3 완료" rows={[MORNING, { status: 'missed', name: '점심', note: '응답 없음 · 15분', warn: true }, EVENING]} />;
}

/** g17 안부 알림을 확인한 뒤 현황. 점심·저녁 모두 미복용 */
export function GAfterWell() {
  return (
    <Overview
      slots={['done', 'missed', 'missed']}
      now={0.86}
      warn
      sum="응답 없음"
      note="점심·저녁 · 오늘 1/3 완료"
      rows={[MORNING, { status: 'missed', name: '점심', note: '응답 없음', warn: true }, { status: 'missed', name: '저녁', note: '응답 없음', warn: true }]}
    />
  );
}

/** g19 오복용 알림·사건을 확인한 뒤 현황. 글자는 먹색, 세모만 빨강 */
export function GAfterWrong() {
  return <Overview slots={['done', 'wrong', 'plan']} now={0.45} sum="1알 부족" note="점심 · 다시 찍는 중" rows={[MORNING, { status: 'wrong', name: '점심', note: '12:31 1알 부족', photo: 'photo-palm-noon-1' }, EVENING]} />;
}

/** g18 '약 없음' 알림 뒤 현황. 약 없음 = 미복용과 같은 마름모, 낱말은 먹색(상태색은 모양에만). 이 회차는 다시 알리지 않는다 */
export function GAfterNoMed() {
  return <Overview slots={['done', 'nomed', 'plan']} now={0.443} sum="약 없음" note="점심 · 오늘 1/3 완료" rows={[MORNING, { status: 'missed', name: '점심', note: '12:31 약 없음' }, EVENING]} />;
}

/** g08 등록된 약이 없을 때. 보호자가 대신 찍을 수 있다 */
export function GEmpty() {
  return (
    <Phone>
      <Head />
      <Tray small now={0.26} />
      <T h left={28} top={300}>
        등록한 약이 없어요
      </T>
      <T s={20} c={C.ink2} left={28} top={352}>
        약봉투를 찍으면 시작해요
      </T>
      <GBtn top={730} icon="camera" label="약봉투 찍기" onPress={() => go('p01-scan')} />
    </Phone>
  );
}

/* ── 달력 (보호자 전용) ── */
const worst = (s: string): Status => (s.includes('w') ? 'wrong' : /[mn]/.test(s) ? 'missed' : s.includes('p') ? 'planned' : 'done');
const LEGEND: Partial<Record<Status, string>> = { done: '완료', missed: '응답 없음', wrong: '확인 필요', planned: '진행 중' };
/** 날 → [아침·점심·저녁 코드(d 완료 · m 미복용 · n 약 없음 · w 오복용 · p 예정), 못 먹은 알 수] */
const DAYS: Record<number, [string, number?]> = { 9: ['ddd'], 10: ['ddd'], 11: ['mmd', 3], 12: ['ddd'], 13: ['dnd', 2], 14: ['ddd'], 15: ['dwd'], 16: ['ddd'], 17: ['ddm', 1], 18: ['ddd'], 19: ['dwm'], 20: ['ddp'] };

/** 응답 없음 마름모 안에 그날 못 먹은 알 수 */
function Diamond({ n, size }: { n: number; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M24 2l22 22-22 22L2 24z" fill={C.paper} stroke={C.miss} strokeWidth={4} strokeLinejoin="round" />
      <SvgText x={24} y={33} fontSize={24} fontWeight="800" fill={C.miss} textAnchor="middle">
        {n}
      </SvgText>
    </Svg>
  );
}

/** 달력 한 칸: 그날 가장 나쁜 상태 · 못 먹은 알 수(목업 예시만) · 약 없음 */
type Cell = { status: Status; n?: number; nomed?: boolean };
const MOCK_CELLS: Record<number, Cell> = Object.fromEntries(Object.entries(DAYS).map(([d, [s, n]]) => [d, { status: worst(s), n, nomed: s.includes('n') }]));

/** GET /patients/{id}/calendar 의 하루 */
type CalDay = { date: string; total: number; done: number; missed: number; wrong: number; pending: number; day_status: 'ALL_DONE' | 'PARTIAL' | 'NONE_DONE' | 'UPCOMING' };
/** 서버 하루 → 칸. 오복용 > 미복용 > 예정 > 완료. 서버는 회차 수만 주므로 마름모 안 숫자(알 수)는 없다 */
function cellOf(d: CalDay): Cell | undefined {
  if (!d.total) return undefined;
  if (d.wrong) return { status: 'wrong' };
  if (d.missed) return { status: 'missed' };
  if (d.pending || d.day_status === 'UPCOMING') return { status: 'planned' };
  return { status: 'done' };
}

/**
 * c08 달력. 1일의 요일부터 채운다. 하루에 모양 하나 = 그날 가장 나쁜 상태(오복용 > 미복용 > 예정 > 완료). 마름모 안 숫자 = 못 먹은 알 수.
 * 마이페이지 → 어르신 고르기(g22)에서 오면 ?patient_id·name 으로 그 어르신의 이번 달(GET /patients/{id}/calendar). 아니면 목업 예시(2026년 11월).
 */
export function Calendar() {
  const q = useLocalSearchParams<{ patient_id?: string; name?: string }>();
  const pid = q.patient_id && /^\d+$/.test(q.patient_id) ? q.patient_id : null;
  const [now] = useState(() => (pid ? new Date() : new Date(2026, 10, 20)));
  const y = now.getFullYear();
  const m = now.getMonth();
  const [cells, setCells] = useState<Record<number, Cell> | null>(pid ? null : MOCK_CELLS);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (!pid) return;
    let live = true;
    const month = `${y}-${String(m + 1).padStart(2, '0')}`;
    api
      .get<{ days: CalDay[] }>(`/patients/${pid}/calendar`, { month })
      .then((r) => {
        if (!live) return;
        const out: Record<number, Cell> = {};
        for (const d of r.days) {
          const c = cellOf(d);
          if (c) out[Number(d.date.slice(8, 10))] = c;
        }
        setCells(out);
      })
      .catch((x) => {
        if (!live) return;
        const st = x instanceof ApiError ? x.status : -1;
        setErr(st === 401 ? '보호자 로그인부터 해 주세요' : st === 0 ? '서버에 연결하지 못했어요' : '달력을 못 불러왔어요');
        setCells({});
      });
    return () => {
      live = false;
    };
  }, [pid, y, m]);
  const lead = new Date(y, m, 1).getDay();
  const count = new Date(y, m + 1, 0).getDate();
  const rows = Math.ceil((lead + count) / 7);
  const h = rows > 5 ? 64 : 72; // 여섯 줄인 달도 범례(672) 위에 들어가게
  const today = now.getDate();
  const title = `${m + 1}월`;
  return (
    <Phone>
      <Back />
      {/* 이름(최대 10자)이 길면 한 줄에 맞춰 글자만 줄인다 */}
      <T h fit={334} left={28} top={132}>
        {pid && q.name ? `${q.name} · ${title}` : title}
      </T>
      <T s={20} k={!!err} c={err ? C.wrong : C.ink2} left={28} right={28} top={186}>
        {err ?? (cells ? '날짜를 누르면 그날 사진을 봐요' : '불러오는 중이에요')}
      </T>
      <View style={[abs({ left: 28, right: 28, top: 252 }), { flexDirection: 'row' }]}>
        {[...'일월화수목금토'].map((d) => (
          <T key={d} s={16} c={C.ink2} style={{ flex: 1, textAlign: 'center' }}>
            {d}
          </T>
        ))}
      </View>
      <View style={[abs({ left: 28, right: 28, top: 280 }), { flexDirection: 'row', flexWrap: 'wrap' }]}>
        {Array.from({ length: lead }, (_, i) => (
          <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: h }} />
        ))}
        {Array.from({ length: count }, (_, i) => i + 1).map((day) => {
          const c = cells?.[day];
          const w = c?.status;
          const n = c?.n;
          const isToday = day === today;
          const label = w ? ' ' + (w === 'missed' && c?.nomed ? '약 없음' : LEGEND[w]) + (n ? `, 안 드신 알약 ${n}알` : '') : '';
          return (
            <Tap
              key={day}
              disabled={!w}
              accessibilityLabel={`${m + 1}월 ${day}일${label}`}
              onPress={() => go('c09-day')}
              style={{ width: `${100 / 7}%`, height: h, alignItems: 'center', paddingTop: 8, gap: 8, borderRadius: R.s, borderWidth: isToday ? 2 : 0, borderColor: C.ink }}
            >
              <T s={16} lh={1} k={isToday} c={w ? C.ink : C.plan}>
                {day}
              </T>
              {w === 'missed' && n ? (
                <View style={{ marginTop: -4 }}>
                  <Diamond n={n} size={40} />
                </View>
              ) : (
                w && <StatusMark s={w} size={32} />
              )}
            </Tap>
          );
        })}
      </View>
      <View style={[abs({ left: 20, right: 20, top: 672 }), { flexDirection: 'row', justifyContent: 'space-between' }]}>
        {(['done', 'missed', 'wrong', 'planned'] as const).map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {/* 서버 달력은 회차 수만 주므로 알 수 마름모는 목업 예시에서만 */}
            {k === 'missed' && !pid ? <Diamond n={2} size={26} /> : <StatusMark s={k} size={20} />}
            <T s={16} c={C.ink2}>
              {k === 'missed' && !pid ? '안 드신 알약' : LEGEND[k]}
            </T>
          </View>
        ))}
      </View>
    </Phone>
  );
}

/* ── 화면 가득 알림 ── */
/** 스위치. 켜짐 = 화면 가득 알림(FULLSCREEN) */
function Switch({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Tap accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={{ width: 64, height: 48, alignItems: 'flex-end', justifyContent: 'center' }}>
      <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: on ? C.ok : C.plan }}>
        <View style={[abs({ left: on ? 23 : 3, top: 3, width: 26, height: 26 }), { borderRadius: 13, backgroundColor: C.white }]} />
      </View>
    </Tap>
  );
}

/** g16 화면 가득 알림. GET/PATCH /api/patients/{id}/alarm-settings. 데이터는 시간대별 POPUP/FULLSCREEN 그대로, 화면만 회차마다 스위치 하나 */
export function AlarmSet() {
  const [lock, setLock] = useState([false, true, true]);
  const rows: [IconName, string, string][] = [
    ['sunrise', '아침', '8:00'],
    ['sun', '점심', '12:30'],
    ['moon', '저녁', '7:00'],
  ];
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        화면 가득 알림
      </T>
      <T s={20} c={C.ink2} left={28} right={28} top={186}>
        {'켜면 잠금 화면 가득 울리고\n사진을 찍어야 꺼져요'}
      </T>
      {rows.map(([icon, name, at], i) => (
        <View key={name} style={[abs({ left: 0, right: 0, top: 264 + i * 96, height: 96 }), { paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={icon} size={24} />
            <T s={20} k>
              {name}
            </T>
          </View>
          <View style={{ height: 36, minWidth: 76, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }}>
            <T s={16} k>
              {at}
            </T>
          </View>
          <Switch on={lock[i]} label={`${name} 화면 가득 알림`} onPress={() => setLock(lock.map((x, j) => (j === i ? !x : x)))} />
        </View>
      ))}
      <T s={16} c={C.ink2} left={28} right={28} top={584}>
        끄면 알림 한 줄, 5분 뒤 큰 소리로 알려요
      </T>
    </Phone>
  );
}
