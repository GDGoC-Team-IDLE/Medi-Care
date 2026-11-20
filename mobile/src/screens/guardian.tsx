// 보호자: 잠금 알림 → 사건 → 현황 · 달력 · 알림 방식
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { go, swap } from '@/lib/nav';
import { PATIENT, TODAY, call } from '@/lib/mock';
import { C } from '@/constants/theme';
import { Icon, Ill, Phone, StatusMark, T, Tap, abs, type IconName, type IllName, type Status } from '@/components/core';
import { Arc, Back, Lock, Noti, type Slot } from '@/components/parts';

const actions = (ack: string) => [
  { label: '전화', onPress: call },
  { label: '확인했어요', onPress: () => swap(ack) },
];

/* ── 잠금 화면 알림 (한 장에 한 건) ── */
/** g10 미복용 */
export function LockMiss() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:45">
        <Noti status="missed" title={`${PATIENT} · 점심 응답 없음`} body="알림·큰 소리에 15분째 응답 없음" onPress={() => swap('g02-missed')} actions={actions('g12-after')} />
      </Lock>
    </Phone>
  );
}
/** g15 해결 알림: 보낸 알림은 못 고치므로 새 알림 1건 */
export function LockResolved() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="1:10">
        <Noti status="done" title={`${PATIENT} · 점심 드셨어요 1:10`} body="늦게 찍었고 맞는 약이었어요" onPress={() => swap('g01-today')} />
      </Lock>
    </Phone>
  );
}
/** g11 오복용 */
export function LockWrong() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:31">
        <Noti status="wrong" title={`${PATIENT} · 점심 1알 부족`} body="드시기 전 사진 · 멈춤 안내함" onPress={() => swap('g03-wrong')} actions={actions('g19-afterwrong')} />
      </Lock>
    </Phone>
  );
}
/** g11t 오복용(다른 회차 약) */
export function LockWrongTime() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:31">
        <Noti status="wrong" title={`${PATIENT} · 점심에 저녁 약 찍음`} body="드시기 전 사진 · 멈춤 안내함" onPress={() => swap('g01-today')} actions={actions('g01-today')} />
      </Lock>
    </Phone>
  );
}
/** g11a 오복용(이미 먹은 회차를 다시 찍음) */
export function LockAgain() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:58">
        <Noti status="wrong" title={`${PATIENT} · 점심 약 한 번 더 찍음`} body="드시기 전 사진 · 멈춤 안내함" onPress={() => swap('g01-today')} actions={actions('g01-today')} />
      </Lock>
    </Phone>
  );
}
/** g11c 알람의 '약 없음' */
export function LockNoMed() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:31">
        <Noti title={`${PATIENT} · 점심 약이 없대요`} body="알람에서 '약 없음'을 눌렀어요" onPress={() => swap('g18-afternomed')} actions={actions('g18-afternomed')} />
      </Lock>
    </Phone>
  );
}
/** g13 안부 신호: 두 회차 연속 미인증이면 1번만 */
export function LockWell() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="20:00">
        <Noti status="missed" title={`${PATIENT} · 점심·저녁 응답 없음`} body="안부를 확인해 주세요" onPress={() => swap('g14-well')} actions={actions('g17-afterwell')} />
      </Lock>
    </Phone>
  );
}

/* ── 사건 화면 ── */
function Event({ status, title, at, warn, ack, children }: { status: Status; title: string; at: string; warn?: boolean; ack: string; children: ReactNode }) {
  return (
    <Phone>
      {/* 사건을 닫고 현황으로. '확인했어요'와 달리 확인 표시는 남기지 않는다 */}
      <Back top={50} onPress={() => swap('g01-today')} />
      <View style={[abs({ left: 56, right: 28, top: 64, height: 32 }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <T s={20} k>
          {PATIENT}
        </T>
        <T s={16} c={C.ink2}>
          {TODAY}
        </T>
      </View>
      <View style={[abs({ left: 28, right: 28, top: 112, height: 48 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <StatusMark s={status} size={32} />
        <T h c={warn ? C.misst : undefined} style={{ flex: 1 }}>
          {title}
        </T>
        <T s={20} c={C.ink2}>
          {at}
        </T>
      </View>
      {children}
      <GBtn top={666} icon="phone" label={`${PATIENT}께 전화`} onPress={call} />
      <Tap onPress={() => swap(ack)} style={[abs({ left: 28, right: 28, top: 738, height: 56 }), { alignItems: 'center', justifyContent: 'center' }]}>
        <T s={20} k>
          확인했어요
        </T>
      </Tap>
    </Phone>
  );
}

function GBtn({ top, icon, label, onPress }: { top: number; icon: IconName; label: string; onPress?: () => void }) {
  return (
    <Tap
      onPress={onPress}
      style={[abs({ left: 28, right: 28, top, height: 64 }), { borderRadius: 32, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
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

/** g02 미복용 사건. 단계는 예정 + 규칙(5분·15분)으로 계산한 값 */
export function MissedEvent() {
  return (
    <Event status="missed" warn title="점심 응답 없음" at="15분" ack="g12-after">
      <Steps
        rows={[
          { icon: 'bell', name: '알림', note: '응답 없음' },
          { icon: 'volume-2', name: '큰 소리', note: '5분 · 응답 없음' },
          { icon: 'phone', name: '보호자', note: '15분 · 지금' },
        ]}
      />
    </Event>
  );
}

/** g03 오복용 사건(개수). 사진 아래 줄은 다음 촬영 결과로 바뀐다 */
export function WrongEvent() {
  return (
    <Event status="wrong" title="점심 1알 부족" at="12:31" ack="g19-afterwrong">
      <Ill name="photo-palm-noon-1" w={180} h={240} style={abs({ left: 28, top: 184 })} />
      <View style={[abs({ left: 224, right: 28, top: 184 }), { gap: 8 }]}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Ill name="pill-capsule" w={48} />
          <Ill name="pill-slot-round" w={48} />
        </View>
        <T s={20} k lh={1.2}>
          {'사진 1알\n예상 2알'}
        </T>
        <T s={16} c={C.ink2}>
          드시기 전 사진
        </T>
      </View>
      <View style={[abs({ left: 28, right: 28, top: 440, height: 44 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Icon name="camera" size={24} />
        <T s={20} k>
          다시 찍는 중
        </T>
      </View>
    </Event>
  );
}

/** g14 안부 확인. 응급 판단 기능이 아니다 */
export function WellEvent() {
  return (
    <Event status="missed" warn title="안부 확인" at="두 번 연속" ack="g17-afterwell">
      <Steps
        rows={[
          { status: 'missed', name: '점심', note: '응답 없음' },
          { status: 'missed', name: '저녁', note: '응답 없음' },
        ]}
      />
      <T s={20} k left={28} right={28} top={336}>
        {'약 알림에 반응이 없어요.\n안부를 확인해 주세요.'}
      </T>
    </Event>
  );
}

/* ── 현황 ── */
function Head() {
  const btn = { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={[abs({ left: 28, right: 16, top: 62, height: 48 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <T h>{PATIENT}</T>
      <T s={16} c={C.ink2} style={{ flex: 1 }}>
        {TODAY}
      </T>
      <Tap accessibilityLabel="달력" onPress={() => go('c08-calendar')} style={btn}>
        <Icon name="calendar-days" size={24} />
      </Tap>
      <Tap accessibilityLabel="알림 방식" onPress={() => go('g16-alarmset')} style={btn}>
        <Icon name="settings" size={24} />
      </Tap>
    </View>
  );
}

type DoseRow = { status: Status; name: string; note: string; warn?: boolean; photo?: IllName };
/** sum = '문제 있나'의 답(문제 없음 / 응답 없음 / 판정 낱말), note = 센 수 */
function Overview({ slots, now, sum, warn, note, rows }: { slots: Slot[]; now: number; sum: string; warn?: boolean; note: string; rows: DoseRow[] }) {
  return (
    <Phone>
      <Head />
      <Arc small slots={slots} now={now} />
      <T h c={warn ? C.misst : undefined} center top={196}>
        {sum}
      </T>
      <T s={20} c={C.ink2} center top={248}>
        {note}
      </T>
      <View style={abs({ left: 0, right: 0, top: 348 })}>
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
                <Ill name={r.photo} w={60} h={80} />
              </Tap>
            ) : (
              <View style={{ width: 60 }} />
            )}
          </View>
        ))}
      </View>
    </Phone>
  );
}

/** g01 보호자 현황. GET 오늘 회차별 상태 · 인증 시각 · 인증 사진 */
export function GToday() {
  return (
    <Overview
      slots={['done', 'done', 'plan']}
      now={0.62}
      sum="문제 없음"
      note="2/3 드심 · 다음 저녁"
      rows={[
        { status: 'done', name: '아침', note: '8:12 완료', photo: 'photo-palm-morning' },
        { status: 'done', name: '점심', note: '12:31 완료', photo: 'photo-palm-noon-2' },
        { status: 'planned', name: '저녁', note: '예정' },
      ]}
    />
  );
}

/** g12 사건 확인 뒤 현황. 미복용 행이 남는다 */
export function GAfter() {
  return (
    <Overview
      slots={['done', 'missed', 'plan']}
      now={0.46}
      warn
      sum="응답 없음"
      note="점심 · 1/3 드심"
      rows={[
        { status: 'done', name: '아침', note: '8:12 완료', photo: 'photo-palm-morning' },
        { status: 'missed', name: '점심', note: '응답 없음 · 15분', warn: true },
        { status: 'planned', name: '저녁', note: '예정' },
      ]}
    />
  );
}

/** g17 안부 알림을 확인한 뒤 현황. 점심·저녁 모두 미복용 */
export function GAfterWell() {
  return (
    <Overview
      slots={['done', 'missed', 'missed']}
      now={0.86}
      warn
      sum="응답 없음"
      note="점심·저녁 · 1/3 드심"
      rows={[
        { status: 'done', name: '아침', note: '8:12 완료', photo: 'photo-palm-morning' },
        { status: 'missed', name: '점심', note: '응답 없음', warn: true },
        { status: 'missed', name: '저녁', note: '응답 없음', warn: true },
      ]}
    />
  );
}

/** g19 오복용 알림·사건을 확인한 뒤 현황. 글자는 ink, 세모만 빨강 */
export function GAfterWrong() {
  return (
    <Overview
      slots={['done', 'wrong', 'plan']}
      now={0.45}
      sum="1알 부족"
      note="점심 · 다시 찍는 중"
      rows={[
        { status: 'done', name: '아침', note: '8:12 완료', photo: 'photo-palm-morning' },
        { status: 'wrong', name: '점심', note: '12:31 1알 부족', photo: 'photo-palm-noon-1' },
        { status: 'planned', name: '저녁', note: '예정' },
      ]}
    />
  );
}

/** g18 '약 없음' 알림 뒤 현황. '약 없음'은 회차 상태가 아니라 앱 표시(회차는 예정 그대로) */
export function GAfterNoMed() {
  return (
    <Overview
      slots={['done', 'plan', 'plan']}
      now={0.443}
      warn
      sum="약 없음"
      note="점심 · 1/3 드심"
      rows={[
        { status: 'done', name: '아침', note: '8:12 완료', photo: 'photo-palm-morning' },
        { status: 'planned', name: '점심', note: '약 없음 · 12:31', warn: true },
        { status: 'planned', name: '저녁', note: '예정' },
      ]}
    />
  );
}

/** g08 등록된 약이 없을 때. 보호자가 대신 찍을 수 있다 */
export function GEmpty() {
  return (
    <Phone>
      <Head />
      <Arc small now={0.26} />
      <T h left={28} top={348}>
        약이 아직 없어요
      </T>
      <T s={20} c={C.ink2} left={28} top={404}>
        {PATIENT} 폰이나 이 폰으로 찍어요
      </T>
      <GBtn top={730} icon="camera" label="약봉투 대신 찍기" onPress={() => go('p01-scan')} />
    </Phone>
  );
}

/* ── 달력 (보호자 전용) ── */
const M: Record<string, Status> = { d: 'done', m: 'missed', w: 'wrong', p: 'planned' };
const DAYS: Record<number, string> = { 9: 'ddd', 10: 'ddd', 11: 'dmd', 12: 'ddd', 13: 'ddd', 14: 'ddd', 15: 'dwd', 16: 'ddd', 17: 'ddm', 18: 'ddd', 19: 'dwm', 20: 'ddp' };

/** c08 11월 달력. 1일 = 일요일. 날짜 칸 = 아침·점심·저녁 상태 모양 */
export function Calendar() {
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        11월
      </T>
      <T s={20} c={C.ink2} left={28} right={28} top={186}>
        날짜를 누르면 그날 사진
      </T>
      <View style={[abs({ left: 28, right: 28, top: 252 }), { flexDirection: 'row' }]}>
        {[...'일월화수목금토'].map((d) => (
          <T key={d} s={16} c={C.ink2} style={{ flex: 1, textAlign: 'center' }}>
            {d}
          </T>
        ))}
      </View>
      <View style={[abs({ left: 28, right: 28, top: 280 }), { flexDirection: 'row', flexWrap: 'wrap' }]}>
        {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => {
          const s = DAYS[day];
          const today = day === 20;
          return (
            <Tap
              key={day}
              disabled={!s}
              accessibilityLabel={`11월 ${day}일`}
              onPress={() => go('c09-day')}
              style={{ width: `${100 / 7}%`, height: 64, alignItems: 'center', paddingTop: 8, gap: 8, borderRadius: 16, backgroundColor: today ? C.ink : undefined }}
            >
              <T s={16} lh={1} c={today ? C.paper : s ? C.ink : C.plan}>
                {day}
              </T>
              {s && (
                <View style={{ flexDirection: 'row', gap: 4, height: 12 }}>
                  {[...s].map((c, j) => (
                    <StatusMark key={j} s={M[c]} size={12} />
                  ))}
                </View>
              )}
            </Tap>
          );
        })}
      </View>
    </Phone>
  );
}

/* ── 알림 방식 ── */
function Seg({ on, icon, label, onPress }: { on: boolean; icon: IconName; label: string; onPress: () => void }) {
  const c = on ? C.ink : C.plan;
  return (
    <Tap
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ width: 96, height: 80, alignItems: 'center', justifyContent: 'center', gap: 4, borderBottomWidth: 4, borderBottomColor: on ? C.ink : C.line }}
    >
      <Icon name={icon} c={c} />
      <T s={16} k c={c}>
        {label}
      </T>
    </Tap>
  );
}

/** g16 알림 방식. GET/PATCH /api/patients/{id}/alarm-settings. 기본은 일반 */
export function AlarmSet() {
  const [lock, setLock] = useState([false, true, true]);
  const set = (i: number, v: boolean) => setLock(lock.map((x, j) => (j === i ? v : x)));
  const rows: [IconName, string][] = [
    ['sunrise', '아침'],
    ['sun', '점심'],
    ['moon', '저녁'],
  ];
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        알림 방식
      </T>
      <T s={20} c={C.ink2} left={28} right={28} top={186}>
        {PATIENT} 폰에 바로 바뀌어요
      </T>
      {rows.map(([icon, name], i) => (
        <View key={name} style={[abs({ left: 0, right: 0, top: 248 + i * 96, height: 96 }), { paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={icon} size={24} />
            <T s={20} k>
              {name}
            </T>
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Seg on={!lock[i]} icon="bell" label="일반" onPress={() => set(i, false)} />
            <Seg on={lock[i]} icon="alarm-clock" label="잠금 화면" onPress={() => set(i, true)} />
          </View>
        </View>
      ))}
      <T s={16} c={C.ink2} left={28} right={28} top={568}>
        {'일반: 알림 한 줄, 5분 뒤 큰 소리.\n잠금 화면: 화면 가득 울리고 찍어야 꺼져요.'}
      </T>
    </Phone>
  );
}
