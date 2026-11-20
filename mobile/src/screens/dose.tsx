// 알림 · 약 없음 · 인증 촬영 · 판정 5종 · 실패/연결 없음 · 카메라 권한
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { back, go, swap } from '@/lib/nav';
import { api, ApiError, appendFile } from '@/lib/api';
import { SAY_COUNT, SLOT_ROW, type Slot } from '@/screens/register';
import { GUARDIAN, call } from '@/lib/mock';
import { C } from '@/constants/theme';
import { Icon, Phone, Row, T, Tap, Up, abs, type IconName } from '@/components/core';
import { Fig3 } from '@/components/figure';
import { Back, Badge, Blink, Btn, Burst, CamTitle, Fig, Lock, PillNoti, Say, ScanCard, Sheet, Shutter, Stop, Sub, Torch, Verdict, Viewfinder, lastShot, type ScanSpec } from '@/components/parts';

const shoot = () => go('p06-shoot');
const told = `${GUARDIAN}에게 알렸어요`;
const callG = `${GUARDIAN}에게 전화하기`;

/* ── 알림 (기본 = 일반 알림 → 5분 뒤 다시, 잠금화면 알람은 보호자가 켠 시간대만) ── */
/** p17 일반 알림. 누르면 잠금 해제 뒤 바로 촬영 */
export function Notice() {
  return (
    <Phone bg={C.lock} fg={C.white}>
      <Lock time="12:30">
        <PillNoti when="지금" title="점심 2알" onPress={shoot} />
      </Lock>
    </Phone>
  );
}

/** p17b 5분 무응답 → 같은 알림을 큰 소리·음성으로 다시. 15분 → 보호자(g10) */
export function NoticeAgain() {
  return (
    <Phone bg={C.lock} fg={C.white}>
      <Lock time="12:35">
        <PillNoti loud when="다시" title="점심 2알" body="5분 지났어요" onPress={shoot} />
      </Lock>
    </Phone>
  );
}

/** 잘못 눌러도 해 없는 안전 3칸 (552–632, 찍기 위). 칸이 좁아 '다시 알림'의 10분은 시계 그림만 */
function Safe3() {
  const items: [IconName, string, () => void][] = [
    ['c-pouch', '약 없어요', () => go('p32-nomed')],
    ['alarm-clock', '다시 알림', back],
    ['phone', GUARDIAN, call],
  ];
  return (
    <View style={[abs({ left: 29, top: 552, width: 332, height: 80 }), { flexDirection: 'row', gap: 16 }]}>
      {items.map(([icon, label, onPress]) => (
        <Tap key={label} onPress={onPress} style={{ width: 100, height: 80, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name={icon} c={C.ink2} />
          <T c={C.ink2}>{label}</T>
        </Tap>
      ))}
    </View>
  );
}

/** 알람 머리: 가장 큰 글자는 회차·알 수. 식사에 약을 묶는 사람에게 시계는 덜 중요하다(context.md) */
function AlarmHead({ time }: { time: string }) {
  return (
    <>
      <Row center top={160}>
        <Icon name="sun" />
        <T s={32} k lh={1}>
          {time}
        </T>
      </Row>
      <T s={84} num center top={200}>
        점심 2알
      </T>
    </>
  );
}

/** p05 잠금화면 알람. 사진을 찍어야 꺼진다. 찍기는 엄지 자리(680–792), 안전 3칸은 그 위 */
export function Alarm() {
  return (
    <Phone bg={C.sun}>
      <AlarmHead time="12:30" />
      <Fig3 name="pouch-noon@150" motion="am-ring" w={180} h={180} style={abs({ left: 105, top: 324 })} />
      <Btn kind="al" icon="camera" label="찍기" onPress={shoot} />
      <Safe3 />
    </Phone>
  );
}

/** p05b 5분 무응답 → 큰 소리·음성. 15분이면 보호자에게 */
export function AlarmLoud() {
  return (
    <Phone bg={C.sun}>
      <AlarmHead time="12:35" />
      <Row center top={300}>
        <Blink times={99} delay={0.5}>
          <Icon name="volume-2" />
        </Blink>
        <T k>소리 나는 중</T>
      </Row>
      <Fig3 name="pouch-noon@150" motion="am-ring loud" w={120} h={120} style={abs({ left: 135, top: 348 })} />
      <T c={C.ink2} center top={488}>
        곧 {GUARDIAN}에게 알려요
      </T>
      <Btn kind="al" icon="camera" label="찍기" onPress={shoot} />
      <Safe3 />
    </Phone>
  );
}

/** p32 '약 없어요' → 보호자에게 알림(g11c). 전화가 걸린 것은 아니다. 확인 → p32b */
export function NoMed() {
  return (
    <Phone>
      <Back close onPress={() => swap('p32b-afternomed')} />
      <Fig fig="pouch-open@240" motion="am-tip" />
      <Badge icon="bell" />
      <Verdict readAloud mv={false} title="약이 없어요" tell={told} />
      <Btn two label="확인" onPress={() => swap('p32b-afternomed')} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p34 보호자가 알림 방식을 바꾼 뒤, 다음 알람 전에 한 번. 열리면 바로 읽어 준다 */
export function AlarmNew() {
  return (
    <Phone>
      <Fig fig="phone-ring@240" motion="am-wave" />
      <Badge icon="alarm-clock" />
      <Verdict readAloud mv={false} title="알림이 바뀌어요" tell="점심·저녁은 화면 가득 울려요" line={`${GUARDIAN}이 바꿨어요`} />
      <Btn label="확인" onPress={() => swap('p04-today')} />
    </Phone>
  );
}

/* ── 인증 촬영 ── */
/** p30 이미 완료된 회차의 촬영 화면을 열었을 때: 찍기 전에 막는다. 기록·알림 없음 → 손은 먹색 */
export function Before() {
  return (
    <Phone>
      <Back close />
      <Fig name="photo-palm-noon-2" left={105} width={180} />
      <Stop ink />
      <Verdict readAloud mv={false} title="이미 드신 약이에요" tell="점심은 12:31에 드셨어요" />
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

const NOON = { icon: 'sun', title: '점심 2알' } as const;

const SLOT_ICON: Record<Slot, IconName> = { MORNING: 'sunrise', LUNCH: 'sun', DINNER: 'moon', BEDTIME: 'moon' };
const slotName = (s: Slot) => SLOT_ROW[s].name;
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** GET /patients/me/dose-slots 의 회차 (쓰는 칸만) */
interface TodaySlot {
  slot_id: number;
  slot: Slot;
  scheduled_at: string;
  expected_count: number;
  status: string; // PENDING · DONE · MISSED · WRONG
}

/** POST /patients/me/dose-slots/{slot_id}/verifications 응답 (쓰는 칸만) */
interface Verify {
  result: string; // OK · WRONG_TIME · ALREADY_TAKEN · COUNT_MISMATCH · RETAKE
  slot: Slot;
  ai_extracted: { bag_slot: Slot | null; pill_count: number | null } | null;
  expected: { pill_count: number };
  appearance_check: { status: string } | null;
  taken_at: string | null;
}

/** 찍을 회차와 그 다음 회차. p06 이 정하고 p18 이 쓴다 */
let target: { slot: TodaySlot; next: TodaySlot | null } | null = null;
/** 마지막 판정. p07~p10 이 글을 채운다 (없으면 예시) */
let verdict: Verify | null = null;

/**
 * 오늘 회차 중 찍을 회차. 알림에서 온 slot_id 가 있으면 그 회차, 없으면 지금 시각에 가장 가까운 회차.
 * 이미 드신 회차도 고른다 → 같은 약을 또 찍으면 서버가 ALREADY_TAKEN 으로 두 번 먹기를 막는다. 회차가 없으면 null
 */
async function pickTarget(slotId?: number, date?: string) {
  // date: p19 '다음 시간대로 이동'(시연)으로 내일 이후 회차를 찍을 때 그날 목록에서 찾는다
  const { slots } = await api.get<{ slots: TodaySlot[] }>('/patients/me/dose-slots', date ? { date } : undefined);
  if (!slots.length) return null;
  const at = (s: TodaySlot) => new Date(s.scheduled_at).getTime();
  const sorted = [...slots].sort((a, b) => at(a) - at(b));
  const gap = (s: TodaySlot) => Math.abs(at(s) - Date.now());
  const slot = sorted.find((s) => s.slot_id === slotId) ?? sorted.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  // 다음 회차: 이 회차보다 늦은 시각의 안 드신 회차 (처방이 여럿이면 같은 시각 회차가 여럿이라 바로 다음 칸이 아님)
  return { slot, next: sorted.find((s) => at(s) > at(slot) && s.status !== 'DONE') ?? null };
}

/** p06 인증 촬영. 흰 점선 = 놓을 자리(위 약포, 아래 손바닥). 열 때 찍을 회차를 받아 제목에 쓴다 (못 받으면 예시) */
export function Shoot() {
  const { slot_id, date } = useLocalSearchParams<{ slot_id?: string; date?: string }>();
  const [head, setHead] = useState<{ icon: IconName; title: string; say: string } | null>(null);
  useEffect(() => {
    target = null;
    let live = true;
    pickTarget(Number(slot_id) || undefined, date).then(
      (t) => {
        target = t;
        if (!live) return;
        if (!t) return swap('p21-empty'); // 오늘 먹을 약이 없음
        const { slot, expected_count: n } = t.slot;
        setHead({ icon: SLOT_ICON[slot], title: `${slotName(slot)} ${n}알`, say: `${slotName(slot)} 약 ${SAY_COUNT[n] ?? n} 알` });
      },
      () => live && setHead({ ...NOON, say: '점심 약 두 알' }),
    );
    return () => {
      live = false;
    };
  }, [slot_id, date]);
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close onPress={() => swap('p04-today')} />
      {head && <CamTitle icon={head.icon} title={head.title} />}
      <Viewfinder guide photo="photo-palm-noon-2" />
      <Shutter onPress={() => go('p18-checking')} />
      <Say cam text={`${head?.say ?? '점심 약 두 알'}. 봉투는 위에, 약은 손바닥에 놓고 찍어 주세요.`} />
    </Phone>
  );
}

/** p06b 찍기 전 밝기 부족 (앱 로컬 감지) */
export function ShootDark() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <CamTitle {...NOON} warn tell="불을 켜 주세요" />
      <Viewfinder dark photo="photo-palm-noon-2" lock={null} />
      <Torch />
      <Shutter at={null} onPress={() => go('p18-checking')} />
      <Say cam text="어두워요. 불을 켜 주세요." />
    </Phone>
  );
}

/** p18 표시 위치(사진 좌표 300×400). 앱에서는 Gemini 응답의 상자(0~1 비율) × 사진 크기 */
const CHECK: ScanSpec = {
  photo: 'photo-palm-noon-2',
  glints: [
    ['<rect x="10" y="14" width="120" height="44" rx="14" transform="translate(14 172) rotate(-7) scale(.82)"/>', 0.66],
    ['<circle cx="215" cy="193" r="19"/>', 1.26],
    ['<ellipse cx="190" cy="231" rx="31" ry="16" transform="rotate(-28 190 231)"/>', 1.38],
  ],
  frame: { d: 'M6.8 181.3V165.3A12 12 0 0 1 18.8 153.3h16M107.8 153.3h16a12 12 0 0 1 12 12v16M135.8 234.6v16a12 12 0 0 1 -12 12h-16M34.8 262.6H18.8a12 12 0 0 1 -12 -12v-16', rotate: 'rotate(-7 71.3 207.9)', at: 1 },
  marks: [
    ['<path d="M64 202.2L111.2 196.4"/>', 4.45],
    ['<ellipse cx="190" cy="231" rx="34" ry="19" transform="rotate(-28 190 231)"/>', 4.75],
    ['<circle cx="215" cy="193" r="21"/>', 5.05],
  ],
  slots: [
    ['pill-capsule', 1.6, 4.85],
    ['pill-round-blue', 2.6, 5.15],
  ],
};

/** 장면(밑줄·칸 채우기)이 끝나는 시각. 판정이 빨리 와도 여기까지는 보여 준다 */
const SCENE_MS = 5900;
/** 이보다 오래 걸리면 p15t */
const SLOW_MS = 8000;
const VERDICT_ROUTE: Record<string, string> = {
  OK: 'p07-ok',
  WRONG_TIME: 'p08-wrongtime',
  ALREADY_TAKEN: 'p09-already',
  COUNT_MISMATCH: 'p10-count',
  RETAKE: 'p11-retake',
};

/** 인증 실패 → 화면 (다시 해 보기는 인증 촬영으로) */
function verifyFail(x: unknown): string {
  const status = x instanceof ApiError ? x.status : -1;
  const code = x instanceof ApiError ? x.code : '';
  if (status === 0) return 'p15-offline';
  if (code === 'SLOT_NOT_TODAY' || code === 'DOSE_SLOT_NOT_FOUND') return 'p04-today';
  if (code === 'IMAGE_REQUIRED' || code === 'UNSUPPORTED_IMAGE_TYPE') return 'p11-retake';
  return 'p15t-slow'; // 503 AI_UNAVAILABLE, 401 등
}

/**
 * p18 보는 중. 찍은 사진을 POST /patients/me/dose-slots/{slot_id}/verifications 로 보낸다.
 * Gemini 는 봉투 시간 표시·알약 개수만 읽고 판정은 서버 규칙. 판정은 장면이 끝난 뒤(RETAKE 는 바로), 8초를 넘으면 p15t.
 * 찍은 사진 없이 열면(화면 목록) 예전처럼 장면이 끝나면 예시 p07 로 간다.
 */
export function Checking() {
  useEffect(() => {
    const uri = lastShot();
    if (!uri) {
      const t = setTimeout(() => swap('p07-ok'), SCENE_MS);
      return () => clearTimeout(t);
    }
    let done = false;
    const to = (id: string) => {
      if (done) return;
      done = true;
      swap(id);
    };
    const started = Date.now();
    const slow = setTimeout(() => to('p15t-slow'), SLOW_MS);
    const run = async () => {
      try {
        const t = target ?? (await pickTarget());
        if (!t) return to('p21-empty');
        target = t;
        const form = new FormData();
        await appendFile(form, 'image', { uri, name: 'dose.jpg' });
        const v = await api.postForm<Verify>(`/patients/me/dose-slots/${t.slot.slot_id}/verifications`, form);
        if (done) return;
        verdict = v;
        const wait = v.result === 'RETAKE' ? 0 : Math.max(0, SCENE_MS - (Date.now() - started));
        setTimeout(() => to(VERDICT_ROUTE[v.result] ?? 'p11-retake'), wait);
      } catch (x) {
        to(verifyFail(x));
      }
    };
    void run();
    return () => {
      done = true;
      clearTimeout(slow);
    };
  }, []);
  return (
    <Phone>
      <Back close />
      <ScanCard spec={CHECK} title="확인하고 있어요" />
    </Phone>
  );
}

/* ── 판정 5종 (OK = 회차 완료). 그림 → 표시(멈춤 손·고리) → 글 → 버튼 ── */
/** p07 OK: 물이 차오르고 알약 둘이 차례로 떨어진다 */
export function Ok() {
  const v = verdict;
  const next = target?.next;
  const tell = v?.taken_at ? `${slotName(v.slot)} ${hhmm(v.taken_at)} 완료` : '점심 12:31 완료';
  // 판정은 OK 지만 알약 색·모양이 등록된 약과 달라 보이면 그 경고를 먼저
  const [line, lineIcon]: [string, IconName | undefined] = !v
    ? ['다음은 저녁 식후', 'moon']
    : v.appearance_check?.status === 'MISMATCH'
      ? ['약 모양이 달라 보여요', 'circle-alert']
      : next
        ? [`다음은 ${slotName(next.slot)}`, SLOT_ICON[next.slot]]
        : ['오늘 약은 다 드셨어요', undefined];
  return (
    <Phone bg={C.ok} fg={C.white}>
      <Burst />
      <Fig fig="verdict-ok@240" motion="vk-ok" left={75} top={152} width={240} height={200} />
      <Verdict readAloud title="맞아요, 드세요" tell={tell} line={line} lineIcon={lineIcon} />
      <Btn up={0.32} kind="w" label="확인" onPress={() => swap('p19-wait')} />
    </Phone>
  );
}

/** p08 WRONG_TIME: 화살표가 저녁 봉투에서 점심 봉투로, 저녁 봉투가 들썩인다 */
export function WrongTime() {
  const bag = verdict?.ai_extracted?.bag_slot; // 사진 속 봉투의 회차
  const want = verdict?.slot; // 지금 찍을 회차
  return (
    // 6판: 멈춤은 화면 전체 빨강 — 맞아요(초록)와 같은 무게, 다시 찍기(흰 바탕)와 한눈에 갈린다
    <Phone bg={C.wrong} fg={C.white}>
      <Back close />
      <Fig fig="verdict-wrong-time@334" motion="vk-wt" />
      <Stop />
      <Verdict readAloud title={`${bag ? slotName(bag) : '저녁'} 약이에요`} tell="드시지 말고 봉투에 넣어 두세요" line={told} lineIcon="bell" />
      <Btn up={0.32} two kind="w" icon="camera" label={`${want ? slotName(want) : '점심'} 봉투 찍기`} onPress={shoot} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p09 ALREADY_TAKEN: 점심을 찍을 차례에 8:12 에 먹은 아침 봉투를 또 찍음. 뜯긴 윗부분이 떨어져 나가고 빈 봉투가 흔들린다 */
export function Already() {
  return (
    <Phone bg={C.wrong} fg={C.white}>
      <Back close />
      <Fig fig="verdict-already@307" motion="vk-al" />
      <Stop />
      <Verdict readAloud title={`${verdict ? slotName(verdict.slot) : '아침'} 약은 드셨어요`} tell="드시지 말고 봉투에 넣어 두세요" line={told} lineIcon="bell" />
      <Btn up={0.32} two kind="w" label="확인" onPress={() => swap('p04-today')} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p10 COUNT_MISMATCH. 개수만 비교한다. 있는 알약이 나오고 빈 자리 점선이 깜빡인다 */
export function Count() {
  const seen = verdict ? (verdict.ai_extracted?.pill_count ?? 0) : 1; // 사진 속 알 수
  const want = verdict ? verdict.expected.pill_count : 2; // 드실 알 수
  const diff = want - seen;
  return (
    <Phone bg={C.wrong} fg={C.white}>
      <Back close />
      <Fig fig="verdict-count@270" motion="vk-ct" width={270} height={200} />
      <Stop />
      <Up delay={0.14}>
        <T k center top={340}>
          {`사진 ${seen}알 · 드실 약 ${want}알`}
        </T>
      </Up>
      <Verdict readAloud title={diff > 0 ? `${diff}알이 모자라요` : `${-diff}알이 많아요`} tell="다시 세어 보세요" line={told} lineIcon="bell" />
      <Btn up={0.32} two kind="w" icon="camera" label="다시 찍기" onPress={shoot} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p11 RETAKE. 회차 상태는 그대로, 보호자 알림 없음 → 손은 먹색. 폰이 흔들리고 다시 화살표가 돈다 */
export function Retake() {
  return (
    <Phone>
      <Back close />
      <Fig fig="verdict-retake@262" motion="vk-rt" />
      <Stop ink />
      <Verdict readAloud title="다시 찍어 주세요" tell="흔들리지 않게 찍어 주세요" />
      <Btn up={0.32} two icon="camera" label="다시 찍기" onPress={shoot} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/* ── 실패 · 연결 없음 (판정 틀 + 삽화 + 원인 배지) ── */
/** p13 등록 추출 실패: 봉투 글씨가 흐려졌다 돌아온다 */
export function NoRead() {
  return (
    <Phone>
      <Back close />
      <Fig fig="envelope@240" motion="am-dim" />
      <Badge icon="eye" />
      <Verdict readAloud mv={false} title="글씨가 안 보여요" tell="봉투를 펴서 다시 찍어 주세요" />
      <Btn two icon="camera" label="다시 찍기" onPress={() => swap('p01-scan')} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p22 '잘 모르겠어요' 뒤: 봉투가 갸웃한다 */
export function Unsure() {
  return (
    <Phone>
      <Back />
      <Fig fig="envelope@240" motion="am-ask" />
      <Badge icon="circle-help" />
      <Verdict readAloud mv={false} title={`${GUARDIAN}과 같이 보세요`} tell={`${GUARDIAN}에게 전화해 보세요`} line={`${GUARDIAN} 폰으로 찍어도 돼요`} />
      <Btn two icon="phone" label={callG} onPress={call} />
      <Sub icon="camera" label="다시 찍기" onPress={() => swap('p01-scan')} />
    </Phone>
  );
}

/** 다시 해 보기: 약봉투 등록에서 왔으면(?retry=p01-scan · p23-review) 그 화면으로, 아니면 인증 촬영으로 */
const RETRY = ['p01-scan', 'p23-review'];
function useRetry() {
  const { retry } = useLocalSearchParams<{ retry?: string }>();
  return () => swap(retry && RETRY.includes(retry) ? retry : 'p06-shoot');
}

/** p15 연결 없음. 판정이 없으면 먹으라고 하지 않는다. 알약이 약포로 돌아가 앉는다 */
export function Offline() {
  const retry = useRetry();
  return (
    <Phone>
      <Back close />
      <Fig fig="pouch-noon@240" motion="am-rest" />
      <Badge icon="wifi-off" blink />
      <Verdict readAloud mv={false} title="인터넷이 안 돼요" tell="약은 봉투에 두세요" line="잠시 뒤 다시 해 보세요" />
      <Btn two icon="refresh-cw" label="다시 해 보기" onPress={retry} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p15t 서버 응답이 8초를 넘을 때: 폰 화면 모서리가 깜빡이며 기다린다 */
export function Slow() {
  const retry = useRetry();
  return (
    <Phone>
      <Back close />
      <Fig fig="phone-shoot@240" motion="am-wait" />
      <Badge icon="clock" beat />
      <Verdict readAloud mv={false} title="오래 걸려요" tell="약은 봉투에 두세요" line="잠시 뒤 다시 해 보세요" />
      <Btn two icon="refresh-cw" label="다시 해 보기" onPress={retry} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p14 카메라 권한 거절. 촬영 화면 위 시트로 올려 어디서 막혔는지 보이게. 켜기 = 앱 설정 열기 */
export function NoCam() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <CamTitle {...NOON} top={106} />
      <Viewfinder off lock={null} />
      <Say text="카메라가 꺼져 있어요. 켜야 약을 찍을 수 있어요." />
      <Sheet>
        <Badge icon="camera-off" left={167} top={452} />
        <T h center top={532}>
          카메라가 꺼져 있어요
        </T>
        <T k center top={590}>
          켜야 약을 찍을 수 있어요
        </T>
        <Btn icon="settings" label="카메라 켜기" onPress={() => Linking.openSettings().catch(() => {})} />
      </Sheet>
    </Phone>
  );
}
