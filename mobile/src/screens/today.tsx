// 오늘 (허브) · 기록 ("오늘 약 먹었나요?" → 지난 날 목록 → 그날) · 기기 권한(알림 꺼짐) · 약 없음 뒤 허브
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Animated, AppState, Easing, Image, Linking, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { back, go, swap } from '@/lib/nav';
import { api, TOKEN_KEYS } from '@/lib/api';
import { getItem } from '@/lib/storage';
import { isWeb } from '@/lib/platform';
import { elderHome } from '@/screens/account';
import { SAY_COUNT, SLOT_ROW, type Slot as DoseTime } from '@/screens/register';
import { GUARDIAN, call } from '@/lib/mock';
import { C, R } from '@/constants/theme';
import { Icon, Ill, Phone, Pop, Row, StatusMark, T, Tap, Up, abs, reduceMotion, type IllName, type Status } from '@/components/core';
import { Fig3 } from '@/components/figure';
import { Back, Btn, Pills, Say, Sub, Tray } from '@/components/parts';

const told = `${GUARDIAN}에게 알렸어요`;
const callG = `${GUARDIAN}에게 전화하기`;

/** 허브 가운데 큰 낱말(56) 앞 상태 모양 + 아래 '딸에게 알렸어요' */
function HubState({ s, word, c }: { s: Status; word: string; c?: string }) {
  return (
    <>
      <Up delay={0.6}>
        <Row center top={356}>
          <StatusMark s={s} size={48} />
          <T s={56} k lh={1} c={c}>
            {word}
          </T>
        </Row>
      </Up>
      <Up delay={0.85}>
        <Row center top={428}>
          <Icon name="bell" size={24} c={C.ink2} />
          <T c={C.ink2}>{told}</T>
        </Row>
      </Up>
    </>
  );
}

/** 어르신 폰에 오늘 회차가 생겼는지 (GET /patients/me/dose-slots). 기기 토큰이 없거나 서버가 안 되면 false */
async function hasDoses() {
  try {
    const { slots } = await api.get<{ slots: unknown[] }>('/patients/me/dose-slots');
    return slots.length > 0;
  } catch {
    return false;
  }
}
/** 약을 기다리는 동안 다시 보는 간격 */
const RECHECK_MS = 15000;

/**
 * p21 등록된 약이 없을 때 (보호자와 연결한 직후 등).
 * 약은 보통 보호자가 등록하므로 주 버튼은 보호자에게 전화로 부탁하기, 보조는 어르신이 약봉투를 직접 찍기.
 * 화면이 떠 있는 동안 15초마다 · 앱으로 돌아올 때마다 오늘 회차를 다시 보고, 생기면 바로 p04 로 넘어간다.
 */
export function Empty() {
  useFocusEffect(
    useCallback(() => {
      let live = true;
      const check = async () => {
        if ((await hasDoses()) && live) swap('p04-today');
      };
      void check();
      const t = setInterval(() => void check(), RECHECK_MS);
      const sub = AppState.addEventListener('change', (st) => st === 'active' && void check());
      return () => {
        live = false;
        clearInterval(t);
        sub.remove();
      };
    }, []),
  );
  return (
    <Phone>
      <Say icon text={`아직 등록된 약이 없어요. ${GUARDIAN}에게 등록을 부탁해 주세요. 등록되면 바로 바뀌어요.`} />
      <Tray now={0.279} />
      <Fig3 name="envelope@132" motion="am-float" w={160} h={132} style={abs({ left: 115, top: 340 })} />
      <Up delay={0.6}>
        <T h center top={500}>
          약이 아직 없어요
        </T>
      </Up>
      <Up delay={0.7}>
        <Row center top={552}>
          {/* 15초마다 다시 보지만 아이콘은 그대로 둔다(깜빡이면 어르신이 헷갈린다) */}
          <Icon name="refresh-cw" size={24} c={C.ink2} />
          <T c={C.ink2}>등록되면 바로 바뀌어요</T>
        </Row>
      </Up>
      <Btn up={0.85} two icon="phone" label={`${GUARDIAN}에게 부탁하기`} onPress={call} />
      <Sub up={0.9} icon="camera" label="약봉투 직접 찍기" onPress={() => go('p01-scan')} />
    </Phone>
  );
}

/** GET /patients/me/dose-slots 의 회차 (p04 에 쓰는 칸만) */
type TodaySlot = {
  slot_id: number;
  slot: DoseTime;
  scheduled_at: string;
  expected_count: number;
  status: 'PENDING' | 'DONE' | 'MISSED' | 'WRONG';
  drugs: { meal_timing: 'BEFORE' | 'AFTER' | 'ANY' }[];
  /** 마지막 인증 기록 (p27 오늘 약) */
  last_log: { result: string; taken_at: string; photo_url: string | null } | null;
};
const TRAY_TIMES: DoseTime[] = ['MORNING', 'LUNCH', 'DINNER'];
const TRAY_STATE = { PENDING: 'plan', DONE: 'done', MISSED: 'missed', WRONG: 'wrong' } as const;
const MEAL = { BEFORE: '식전', AFTER: '식후', ANY: '식사와 무관' } as const;
const PILL_ILLS: IllName[] = ['pill-capsule', 'pill-round-blue', 'pill-scored'];

/** 지금 먹을 회차: 아직 안 드신 회차 중 지금 시각에 가장 가까운 회차 (다 드셨으면 null) */
function pickNow(slots: TodaySlot[]): TodaySlot | null {
  const gap = (s: TodaySlot) => Math.abs(new Date(s.scheduled_at).getTime() - Date.now());
  const left = slots.filter((s) => s.status !== 'DONE');
  return left.length ? left.reduce((a, b) => (gap(b) < gap(a) ? b : a)) : null;
}

/** 약통 칸(아침·점심·저녁) 상태. 처방이 여럿이면 같은 시간대 회차가 여럿이라, 하나라도 남았으면 그 상태로 */
function trayOf(slots: TodaySlot[]) {
  return TRAY_TIMES.map((t) => {
    const same = slots.filter((x) => x.slot === t);
    if (!same.length) return 'none' as const;
    const st = (['WRONG', 'MISSED', 'PENDING'] as const).find((k) => same.some((x) => x.status === k)) ?? 'DONE';
    return TRAY_STATE[st];
  });
}

/**
 * 오늘(date 를 주면 그날) 회차. undefined = 불러오는 중 · null = 기기 연결 전(화면 목록 → 예시) · 'error' = 연결된 폰인데 못 불러옴.
 * 화면에 올 때마다 다시 본다
 */
function useTodaySlots(date?: string) {
  const [slots, setSlots] = useState<TodaySlot[] | null | undefined | 'error'>(undefined);
  const load = useCallback(() => {
    let live = true;
    api
      .get<{ slots: TodaySlot[] }>('/patients/me/dose-slots', date ? { date } : undefined)
      .then((r) => live && setSlots(r.slots))
      // 실제 어르신 폰에서 예시 약을 안내하면 안 되므로, 기기 토큰이 있으면 예시 대신 오류를 보인다
      .catch(async () => {
        const paired = !!(await getItem(TOKEN_KEYS.device));
        if (live) setSlots(paired ? 'error' : null);
      });
    return () => {
      live = false;
    };
  }, [date]);
  useFocusEffect(load);
  return { slots, retry: () => (setSlots(undefined), load()) };
}

const WEEKDAY = '일월화수목금토';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** '2026-11-19' → { short: '19일 목', long: '19일 목요일' } */
function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return { short: `${d.getDate()}일 ${WEEKDAY[d.getDay()]}`, long: `${d.getDate()}일 ${WEEKDAY[d.getDay()]}요일` };
}

/** 어제부터 n 일 동안의 회차 (GET /patients/me/dose-slots?date=). 상태 뜻은 useTodaySlots 와 같다 */
function usePastDays(n = 6) {
  const [days, setDays] = useState<{ date: string; slots: TodaySlot[] }[] | null | undefined | 'error'>(undefined);
  const load = useCallback(() => {
    let live = true;
    const dates = Array.from({ length: n }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i - 1);
      return ymd(d);
    });
    Promise.all(dates.map((date) => api.get<{ slots: TodaySlot[] }>('/patients/me/dose-slots', { date }).then((r) => ({ date, slots: r.slots }))))
      .then((d) => live && setDays(d))
      .catch(async () => {
        const paired = !!(await getItem(TOKEN_KEYS.device));
        if (live) setDays(paired ? 'error' : null);
      });
    return () => {
      live = false;
    };
  }, [n]);
  useFocusEffect(load);
  return { days, retry: () => (setDays(undefined), load()) };
}

/** 지난 날 칸 하나(아침·점심·저녁). 회차가 없으면 null. 지난 날에 인증이 없는 회차는 기록 없음 */
function pastMark(slots: TodaySlot[], time: DoseTime): Status | null {
  const same = slots.filter((s) => s.slot === time);
  if (!same.length) return null;
  if (same.some((s) => s.status === 'WRONG')) return 'wrong';
  if (same.some((s) => s.status !== 'DONE')) return 'missed';
  return 'done';
}

/** 연결된 어르신 폰에서 오늘 회차를 못 불러왔을 때. 예시 약을 보이지 않는다 */
function LoadFail({ retry }: { retry: () => void }) {
  return (
    <Phone>
      <Say icon text="약 정보를 불러오지 못했어요. 잠시 뒤 다시 해 주세요." />
      <Tray now={1} />
      <Up delay={0.6}>
        <T s={32} k center top={380}>
          불러오지 못했어요
        </T>
      </Up>
      <Btn up={0.85} two icon="refresh-cw" label="다시 해 보기" onPress={retry} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p04 오늘: 지금 먹을 회차. 회차 상태는 약통 칸으로만 말한다 */
export function Today() {
  // undefined = 불러오는 중 · null = 기기 연결 전(화면 목록에서 바로 열기 → 예시) · 'error' = 연결된 폰인데 못 불러옴
  const [data, setData] = useState<{ slots: TodaySlot[]; cur: TodaySlot | null } | null | undefined | 'error'>(undefined);
  // 화면에 올 때마다 · 다시 해 보기를 누를 때 오늘 회차를 다시 본다
  const load = useCallback(() => {
    let live = true;
    api
      .get<{ slots: TodaySlot[] }>('/patients/me/dose-slots')
      .then(({ slots: s }) => {
        if (!live) return;
        if (!s.length) return swap('p21-empty'); // 오늘 회차 없음
        setData({ slots: s, cur: pickNow(s) });
      })
      // 실제 어르신 폰에서 예시 약을 안내하면 안 되므로, 기기 토큰이 있으면 예시 대신 오류를 보인다
      .catch(async () => {
        const paired = !!(await getItem(TOKEN_KEYS.device));
        if (live) setData(paired ? 'error' : null);
      });
    return () => {
      live = false;
    };
  }, []);
  useFocusEffect(load);
  if (data === undefined) return <Phone>{null}</Phone>;
  if (data === 'error') return <LoadFail retry={() => (setData(undefined), load())} />;
  if (data === null) {
    return (
      <Phone>
        <Say icon text="점심 약 드실 시간이에요. 식후 두 알. 드시기 전에 사진을 찍어 주세요." />
        <Tray slots={['done', 'plan', 'plan']} f={1} cur={1} now={0.443} />
        <Up delay={0.6}>
          <T s={84} num center top={360}>
            점심
          </T>
        </Up>
        <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
        <Btn up={0.85} icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
      </Phone>
    );
  }
  const { slots, cur } = data;
  const tray = trayOf(slots);
  if (!cur) {
    return (
      <Phone>
        <Say icon text="오늘 약은 다 드셨어요." />
        <Tray slots={tray} now={1} />
        <Up delay={0.6}>
          <T s={56} k center top={380}>
            다 드셨어요
          </T>
        </Up>
        <Btn up={0.85} kind="idle" label="오늘 먹은 약 보기" onPress={() => go('p27-didtake')} />
      </Phone>
    );
  }
  const f = TRAY_TIMES.indexOf(cur.slot); // 자기 전은 약통 칸이 없어 -1
  const name = SLOT_ROW[cur.slot].name;
  const n = cur.expected_count;
  const meal = MEAL[cur.drugs[0]?.meal_timing ?? 'AFTER'];
  return (
    <Phone>
      <Say icon text={`${name} 약 드실 시간이에요. ${meal} ${SAY_COUNT[n] ?? n} 알. 드시기 전에 사진을 찍어 주세요.`} />
      <Tray slots={tray} f={f >= 0 ? f : undefined} cur={f >= 0 ? f : undefined} now={f >= 0 ? 0.443 : 1} />
      <Up delay={0.6}>
        <T s={84} num center top={360}>
          {name}
        </T>
      </Up>
      <Pills pills={cur.drugs.slice(0, 4).map((_, i) => PILL_ILLS[i % PILL_ILLS.length])} count={`${n}알`} meal={meal} />
      <Btn up={0.85} icon="camera" label="찍기" onPress={() => go(`p06-shoot?slot_id=${cur.slot_id}`)} />
    </Phone>
  );
}

/**
 * p19 할 일이 없는 상태: 다음 회차를 회색으로. 다음 = 아직 안 드신(예정) 회차 중 가장 이른 시간대.
 * 알 수는 그 시간대 예정 회차를 모두 더한 수(처방이 여럿이면 같은 시간대 회차가 여럿). 기기 연결 전(화면 목록)이면 예시
 */
export function Wait() {
  const { slots, retry } = useTodaySlots();
  if (slots === undefined) return <Phone>{null}</Phone>;
  if (slots === 'error') return <LoadFail retry={retry} />;
  if (slots !== null) {
    const tray = trayOf(slots);
    const pending = slots.filter((s) => s.status === 'PENDING').sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    const next = pending[0];
    if (!next) {
      const allDone = slots.length > 0 && slots.every((s) => s.status === 'DONE');
      return (
        <Phone>
          <Say icon text={allDone ? '오늘 약은 다 드셨어요.' : '오늘 남은 약이 없어요.'} />
          <Tray slots={tray} now={1} />
          <Up delay={0.6}>
            <T s={56} k center top={380}>
              {allDone ? '다 드셨어요' : '남은 약이 없어요'}
            </T>
          </Up>
          <Btn up={0.85} kind="idle" label="오늘 먹은 약 보기" onPress={() => go('p27-didtake')} />
        </Phone>
      );
    }
    const same = pending.filter((s) => s.slot === next.slot);
    const n = same.reduce((sum, s) => sum + s.expected_count, 0);
    const drugs = same.flatMap((s) => s.drugs);
    const name = SLOT_ROW[next.slot].name;
    const meal = MEAL[drugs[0]?.meal_timing ?? 'AFTER'];
    const f = TRAY_TIMES.indexOf(next.slot); // 자기 전은 약통 칸이 없어 -1
    return (
      <Phone>
        <Say icon text={`다음은 ${name} ${meal} ${SAY_COUNT[n] ?? n} 알이에요.`} />
        <Tray slots={tray} f={f >= 0 ? f : undefined} now={f >= 0 ? 0.62 : 1} />
        <Up delay={0.6}>
          <T s={32} k c={C.plan} center top={336}>
            다음
          </T>
        </Up>
        <Up delay={0.7}>
          <T s={84} num c={C.plan} center top={380}>
            {name}
          </T>
        </Up>
        <Pills pills={drugs.slice(0, 4).map((_, i) => PILL_ILLS[i % PILL_ILLS.length])} count={`${n}알`} meal={meal} />
        <Btn up={0.85} kind="idle" label="오늘 먹은 약 보기" onPress={() => go('p27-didtake')} />
      </Phone>
    );
  }
  return (
    <Phone>
      <Say icon text="점심 약은 드셨어요. 다음은 저녁 식후 세 알이에요." />
      <Tray slots={['done', 'done', 'plan']} f={2} now={0.62} />
      <Up delay={0.6}>
        <T s={32} k c={C.plan} center top={336}>
          다음
        </T>
      </Up>
      <Up delay={0.7}>
        <T s={84} num c={C.plan} center top={380}>
          저녁
        </T>
      </Up>
      <Pills pills={['pill-capsule', 'pill-round-blue', 'pill-scored']} count="3알" meal="식후" />
      <Btn up={0.85} kind="idle" label="오늘 먹은 약 보기" onPress={() => go('p27-didtake')} />
    </Phone>
  );
}

/**
 * p19-wait-demo 시연용(실제 흐름 아님): p19 예시와 같은 대기 화면 + '다음 시간대로 이동'.
 * 누르면 점심 뒤 대기에서 저녁 시간(저녁이 '지금', 찍기)으로 바뀌고, 같은 자리 '처음으로'로 되돌린다.
 * 서버·기기 연결 없이 늘 예시로 그린다. 바뀔 때마다 key 로 다시 그려 들어오는 움직임을 다시 보인다
 */
export function WaitDemo() {
  const [evening, setEvening] = useState(false);
  const toggle = () => setEvening((v) => !v);
  if (evening) {
    return (
      <Phone key="evening">
        <Say icon text="저녁 약 드실 시간이에요. 식후 세 알. 드시기 전에 사진을 찍어 주세요." />
        <Tray slots={['done', 'done', 'plan']} f={2} cur={2} now={0.8235} />
        <Up delay={0.6}>
          <T s={84} num center top={360}>
            저녁
          </T>
        </Up>
        <Pills pills={['pill-capsule', 'pill-round-blue', 'pill-scored']} count="3알" meal="식후" />
        <Btn up={0.85} two icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
        <Sub up={0.9} icon="arrow-right" label="처음으로" onPress={toggle} />
      </Phone>
    );
  }
  return (
    <Phone key="wait">
      <Say icon text="점심 약은 드셨어요. 다음은 저녁 식후 세 알이에요." />
      <Tray slots={['done', 'done', 'plan']} f={2} now={0.62} />
      <Up delay={0.6}>
        <T s={32} k c={C.plan} center top={336}>
          다음
        </T>
      </Up>
      <Up delay={0.7}>
        <T s={84} num c={C.plan} center top={380}>
          저녁
        </T>
      </Up>
      <Pills pills={['pill-capsule', 'pill-round-blue', 'pill-scored']} count="3알" meal="식후" />
      <Btn up={0.85} two kind="idle" label="오늘 먹은 약 보기" onPress={() => go('p27-didtake')} />
      <Sub up={0.9} icon="arrow-right" label="다음 시간대로 이동" onPress={toggle} />
    </Phone>
  );
}

/** p20 미복용(15분 무응답 → 보호자 알림 뒤). 늦게 찍어 OK 면 완료로 바뀐다 */
export function Missed() {
  return (
    <Phone>
      <Say icon text={`점심 약 기록이 없어요. ${told}. 지금 드시려면 사진을 찍어 주세요.`} />
      <Tray slots={['done', 'missed', 'plan']} f={1} now={0.46} />
      <HubState s="missed" word="기록 없음" c={C.misst} />
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn up={0.85} two icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p16 오복용(개수 다름). 다시 찍어 OK 면 완료로 바뀐다 */
export function Flagged() {
  return (
    <Phone>
      <Say icon text={`점심 약이 한 알 부족했어요. ${told}. 두 알을 놓고 다시 찍어 주세요.`} />
      <Tray slots={['done', 'wrong', 'plan']} f={1} now={0.45} />
      <HubState s="wrong" word="1알 부족" />
      <Pills pills={['pill-capsule', 'pill-slot-round']} miss={1} count="2알" meal="식후" />
      <Btn up={0.85} two icon="camera" label="다시 찍기" onPress={() => go('p06-shoot')} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p32b '약 없어요' 뒤 허브. 이 회차는 다시 알리지 않으니 '찍기'를 다시 내밀지 않는다 */
export function AfterNoMed() {
  return (
    <Phone>
      <Say icon text={`점심 약이 없어요. ${told}. 약을 찾으면 약 찾았어요를 눌러 주세요.`} />
      <Tray slots={['done', 'nomed', 'plan']} f={1} now={0.45} />
      <HubState s="missed" word="약 없음" />
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn up={0.85} two icon="phone" label={callG} onPress={call} />
      <Sub up={0.9} icon="camera" label="약 찾았어요" onPress={() => go('p06-shoot')} />
    </Phone>
  );
}

const goElderHome = async () => swap(await elderHome());

/** p26 알림 권한이 꺼졌을 때. 설정에서 켜고 앱으로 돌아오면 다시 확인해 넘어간다. 웹은 알림이 없어 버튼이 바로 넘어간다 */
export function BellOff() {
  useEffect(() => {
    if (isWeb) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void Notifications.getPermissionsAsync().then(({ status }) => {
        if (status === 'granted') void goElderHome();
      });
    });
    return () => sub.remove();
  }, []);
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    const a = Animated.sequence([Animated.delay(400), Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.sin), useNativeDriver: false })]);
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Phone>
      <Say icon text="알림이 꺼져 있어요. 알림을 켜야 약 시간을 알려 드려요." />
      <Tray slots={['plan', 'plan', 'plan']} now={0.279} />
      <Row center top={336}>
        <Animated.View style={{ transform: [{ translateX: v.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1], outputRange: [0, -7, 7, -5, 5, -2, 0] }) }] }}>
          <Icon name="bell-off" size={80} />
        </Animated.View>
      </Row>
      <T s={32} k center top={436}>
        알림이 꺼져 있어요
      </T>
      <Btn up={0.85} two icon="bell-ring" label="알림 켜기" onPress={() => (isWeb ? void goElderHome() : void Linking.openSettings().catch(() => {}))} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/* ── 기록 ── */
function TimeRow({ top, status, name, note, noteColor, photo, photoUri, i = 0 }: { top: number; status: Status; name: string; note: string; noteColor?: string; photo?: IllName; /** 실제 인증 사진 */ photoUri?: string; i?: number }) {
  return (
    <View style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <Pop delay={250 + i * 90}>
        <StatusMark s={status} />
      </Pop>
      <View style={{ flex: 1 }}>
        <T s={32} k lh={1.1}>
          {name}
        </T>
        <T c={noteColor ?? C.ink2}>{note}</T>
      </View>
      {photo || photoUri ? (
        <Tap accessibilityLabel={`${name} 사진`}>
          <View style={{ borderRadius: R.s, overflow: 'hidden' }}>
            {photoUri ? <Image source={{ uri: photoUri }} style={{ width: 72, height: 96 }} resizeMode="cover" /> : <Ill name={photo!} w={72} h={96} />}
          </View>
        </Tap>
      ) : (
        <View style={{ width: 72 }} />
      )}
    </View>
  );
}

const RESULT_NOTE: Record<string, string> = { COUNT_MISMATCH: '개수 다름', WRONG_TIME: '다른 회차 약', ALREADY_TAKEN: '이미 드심' };
const clock = (iso: string) => new Date(iso);
type DayRow = { time: DoseTime; status: Status; note: string; noteColor?: string; photoUri?: string; say: string };

/** 그날 회차를 시간대마다 한 줄로. 처방이 여럿이면 같은 시간대 회차가 여럿이라 합친다. past = 지난 날(인증 없는 회차는 기록 없음) */
function dayRows(slots: TodaySlot[], past = false): DayRow[] {
  return (['MORNING', 'LUNCH', 'DINNER', 'BEDTIME'] as DoseTime[]).flatMap((time): DayRow[] => {
    const same = slots.filter((s) => s.slot === time);
    if (!same.length) return [];
    const name = SLOT_ROW[time].name;
    const last = same
      .map((s) => s.last_log)
      .filter((l) => l !== null)
      .sort((a, b) => clock(a.taken_at).getTime() - clock(b.taken_at).getTime())
      .pop();
    const d = last ? clock(last.taken_at) : null;
    const hm = d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    if (same.every((s) => s.status === 'DONE') && d) {
      return [{ time, status: 'done', note: `${hm} 완료`, photoUri: last?.photo_url ?? undefined, say: `${name} 약은 ${d.getHours()}시 ${d.getMinutes()}분에 드셨어요` }];
    }
    if (same.some((s) => s.status === 'WRONG')) {
      return [{ time, status: 'wrong', note: `${hm} ${RESULT_NOTE[last?.result ?? ''] ?? '확인 필요'}`.trim(), photoUri: last?.photo_url ?? undefined, say: `${name} 약은 확인이 필요해요` }];
    }
    if (same.some((s) => s.status === 'MISSED')) return [{ time, status: 'missed', note: '기록 없음', noteColor: C.misst, say: `${name} 약은 기록이 없어요` }];
    const some = same.some((s) => s.status === 'DONE'); // 처방이 여럿인데 일부만 드심
    if (past) return [{ time, status: 'missed', note: some ? '일부 완료' : '기록 없음', noteColor: C.misst, say: `${name} 약은 기록이 없어요` }];
    return [{ time, status: 'planned', note: some ? '일부 완료' : '예정', noteColor: C.plan, say: `${name} 약은 아직이에요` }];
  });
}

/** p27 오늘 약. GET /patients/me/dose-slots 의 오늘 회차 · 마지막 인증 기록. 기기 연결 전(화면 목록)이면 예시 */
export function DidTake() {
  const { slots, retry } = useTodaySlots();
  const rows = Array.isArray(slots) ? dayRows(slots) : slots;
  if (rows === undefined) return <Phone>{null}</Phone>;
  if (rows === 'error' || (rows && !rows.length)) {
    return (
      <Phone>
        <Back />
        <T h left={28} top={132}>
          오늘 약
        </T>
        <T k left={28} right={28} top={228}>
          {rows === 'error' ? '불러오지 못했어요' : '오늘 드실 약이 없어요'}
        </T>
        {rows === 'error' ? <Btn two icon="refresh-cw" label="다시 해 보기" onPress={retry} /> : <Btn two label="확인" onPress={back} />}
        <Sub icon="history" label="지난 기록 보기" onPress={() => go('p33-days')} />
      </Phone>
    );
  }
  if (rows) {
    const four = rows.length > 3; // 자기 전까지 네 줄이면 버튼에 닿지 않게 좁힌다
    return (
      <Phone>
        <Back />
        <Say text={`${rows.map((r) => r.say).join('. ')}.`} />
        <T h left={28} top={132}>
          오늘 약
        </T>
        {rows.map((r, i) => (
          <TimeRow key={r.time} i={i} top={(four ? 204 : 228) + i * (four ? 100 : 120)} status={r.status} name={SLOT_ROW[r.time].name} note={r.note} noteColor={r.noteColor} photoUri={r.photoUri} />
        ))}
        <Btn two label="확인" onPress={back} />
        <Sub icon="history" label="지난 기록 보기" onPress={() => go('p33-days')} />
      </Phone>
    );
  }
  return (
    <Phone>
      <Back />
      <Say text="아침 약은 8시 12분에, 점심 약은 12시 31분에 드셨어요. 저녁 약은 저녁 식후에 드세요." />
      <T h left={28} top={132}>
        오늘 약
      </T>
      <TimeRow top={228} status="done" name="아침" note="8:12 완료" photo="photo-palm-morning" />
      <TimeRow i={1} top={348} status="done" name="점심" note="12:31 완료" photo="photo-palm-noon-2" />
      <TimeRow i={2} top={468} status="planned" name="저녁" note="예정" noteColor={C.plan} />
      <Btn two label="확인" onPress={back} />
      <Sub icon="history" label="지난 기록 보기" onPress={() => go('p33-days')} />
    </Phone>
  );
}

const PAST: [string, Status, Status, Status][] = [
  ['19일 목', 'done', 'wrong', 'missed'],
  ['18일 수', 'done', 'done', 'done'],
  ['17일 화', 'done', 'done', 'missed'],
  ['16일 월', 'done', 'done', 'done'],
  ['15일 일', 'done', 'wrong', 'done'],
  ['14일 토', 'done', 'done', 'done'],
];

/**
 * p33 지난 날: 월 달력 대신 6일 목록. 모양 셋 = 아침·점심·저녁.
 * 어제부터 6일 중 회차가 있는 날만, 없는 시간대 칸은 비운다. 기기 연결 전(화면 목록)이면 예시
 */
export function PastDays() {
  const { days, retry } = usePastDays();
  if (days === undefined) return <Phone>{null}</Phone>;
  if (days === 'error') return <LoadFail retry={retry} />;
  const list =
    days === null
      ? PAST.map(([day, a, b, c]) => ({ key: day, label: day, marks: [a, b, c] as (Status | null)[], href: 'c09-day' }))
      : days
          .filter((d) => d.slots.length)
          .map((d) => ({ key: d.date, label: dayLabel(d.date).short, marks: TRAY_TIMES.map((t) => pastMark(d.slots, t)), href: `c09-day?date=${d.date}` }));
  return (
    <Phone>
      <Back />
      <Say text={list.length ? '지난 날 기록이에요. 날짜를 누르면 그날 사진을 볼 수 있어요.' : '지난 기록이 없어요.'} />
      <T h left={28} top={132}>
        지난 기록
      </T>
      {list.length ? (
        <View style={[abs({ left: 28, right: 28, top: 192 }), { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }]}>
          {(['sunrise', 'sun', 'moon'] as const).map((n) => (
            <View key={n} style={{ width: 40, alignItems: 'center' }}>
              <Icon name={n} size={24} c={C.ink2} />
            </View>
          ))}
        </View>
      ) : (
        <T k left={28} right={28} top={228}>
          지난 기록이 없어요
        </T>
      )}
      {list.map((r, i) => (
        <Tap key={r.key} onPress={() => go(r.href)} style={[abs({ left: 28, right: 28, top: 228 + i * 68, height: 60 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
          <T k style={{ flex: 1 }}>
            {r.label}
          </T>
          {r.marks.map((m, j) => (m ? <StatusMark key={j} s={m} size={40} /> : <View key={j} style={{ width: 40 }} />))}
        </Tap>
      ))}
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

/** c09 그날의 기록. 한 회차에 여러 장이면 마지막 판정 사진 한 장. p33 에서 ?date= 로 온다(없으면 예시) */
export function Day() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { slots, retry } = useTodaySlots(date);
  if (date) {
    if (slots === undefined) return <Phone>{null}</Phone>;
    if (slots === 'error') return <LoadFail retry={retry} />;
    if (slots !== null) {
      const rows = dayRows(slots, true);
      const { long } = dayLabel(date);
      const four = rows.length > 3; // 자기 전까지 네 줄이면 버튼에 닿지 않게 좁힌다
      return (
        <Phone>
          <Back />
          <Say text={`${long}. ${rows.length ? rows.map((r) => r.say).join('. ') : '이날은 드실 약이 없었어요'}.`} />
          <T h left={28} top={132}>
            {long}
          </T>
          {rows.length ? (
            rows.map((r, i) => (
              <TimeRow key={r.time} i={i} top={(four ? 204 : 228) + i * (four ? 100 : 120)} status={r.status} name={SLOT_ROW[r.time].name} note={r.note} noteColor={r.noteColor} photoUri={r.photoUri} />
            ))
          ) : (
            <T k left={28} right={28} top={228}>
              이날은 드실 약이 없었어요
            </T>
          )}
          <Btn label="닫기" onPress={back} />
        </Phone>
      );
    }
  }
  return (
    <Phone>
      <Back />
      <Say text="19일 목요일. 아침은 드셨고, 점심은 한 알 부족했고, 저녁은 기록이 없어요." />
      <T h left={28} top={132}>
        19일 목요일
      </T>
      <TimeRow top={228} status="done" name="아침" note="8:05 완료" photo="photo-palm-morning" />
      <TimeRow i={1} top={348} status="wrong" name="점심" note="12:40 1알 부족" photo="photo-palm-noon-1" />
      <TimeRow i={2} top={468} status="missed" name="저녁" note="기록 없음" noteColor={C.misst} />
      <Btn label="닫기" onPress={back} />
    </Phone>
  );
}
