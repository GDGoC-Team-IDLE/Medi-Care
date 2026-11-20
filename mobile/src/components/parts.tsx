// 화면 유형마다 되풀이되는 부품 (목업 6판의 0번 틀 · 허브 약통 칸 · 판정 · 카메라 · 글자 분석 · 잠금 알림)
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Pattern, Rect, Stop as SvgStop, SvgXml } from 'react-native-svg';
import * as Speech from 'expo-speech';
import { back } from '@/lib/nav';
import { TODAY_LONG } from '@/lib/mock';
import { C, R, W } from '@/constants/theme';
import { Color, Icon, Ill, Pop, Row, StatusMark, T, Tap, Up, abs, reduceMotion, useBackSlot, useFg, type IconName, type IllName, type Pos, type Status } from './core';
import { Fig3 } from './figure';

const native = Platform.OS !== 'web';
const OUT = Easing.bezier(0.05, 0.7, 0.1, 1);
const STD = Easing.bezier(0.2, 0, 0, 1);

/** 한 번 0 → 1 로 가는 값(지연·길이는 초). 동작 줄이기면 바로 1 */
function useOnce(delay: number, dur: number, easing = OUT, nativeDriver = native) {
  const [v] = useState(() => new Animated.Value(reduceMotion() ? 1 : 0));
  useEffect(() => {
    if (reduceMotion()) return;
    const a = Animated.timing(v, { toValue: 1, duration: dur * 1000, delay: delay * 1000, easing, useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [v, delay, dur, easing, nativeDriver]);
  return v;
}

/* ── 윗줄: 뒤로/닫기 · 듣기 ── */
/** 뒤로(‹)·닫기(×). 누르는 곳은 60, 보이는 선의 왼쪽 끝은 시작선 28 에 맞춘다. */
export function Back({ close, onPress, top = 58 }: { close?: boolean; onPress?: () => void; top?: number }) {
  const slot = useBackSlot();
  useLayoutEffect(() => {
    slot(true);
    return () => slot(false);
  }, [slot]);
  return (
    <Tap
      accessibilityLabel={close ? '닫기' : '뒤로'}
      onPress={onPress ?? back}
      hitSlop={8}
      style={[abs({ left: close ? 6 : 2, top, width: 60, height: 60 }), { alignItems: 'center', justifyContent: 'center' }]}
    >
      <Icon name={close ? 'x' : 'chevron-left'} />
    </Tap>
  );
}

/** 듣기: 화면 내용을 소리로 읽어 준다. cam = 찍는 화면(셔터 오른쪽, 오른손 엄지 자리) */
export function Say({ text, icon, cam }: { text: string; icon?: boolean; cam?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const utterance = useRef<symbol | null>(null);
  const stopping = useRef(false);
  const message = text.trim();

  const stop = useCallback(() => {
    if (!utterance.current) return;
    utterance.current = null;
    setPlaying(false);
    stopping.current = true;
    void Speech.stop()
      .catch(() => undefined)
      .finally(() => {
        stopping.current = false;
      });
  }, []);

  useFocusEffect(useCallback(() => (message ? stop : undefined), [stop, message]));

  const toggle = () => {
    if (stopping.current || !message) return;
    if (utterance.current) {
      stop();
      return;
    }

    const current = Symbol();
    utterance.current = current;
    setPlaying(true);
    const finish = () => {
      if (utterance.current !== current) return;
      utterance.current = null;
      setPlaying(false);
    };
    try {
      Speech.speak(message, {
        language: 'ko-KR',
        rate: 0.9,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      finish();
    }
  };

  if (!message) return null;
  const label = playing ? '중지' : '듣기';
  return (
    <Tap
      accessibilityLabel={playing ? '음성 안내 중지' : '음성 안내 듣기'}
      onPress={toggle}
      style={[
        // 글자·아이콘의 오른쪽 끝이 끝선 28 에 오게
        abs({ right: icon ? 12 : 16, top: cam ? 722 : 58, height: 60 }),
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
        icon ? { width: 60 } : { paddingHorizontal: 12 },
      ]}
    >
      <Icon name={playing ? 'volume-x' : 'volume-2'} />
      {!icon && <T k>{label}</T>}
    </Tap>
  );
}

/* ── 행동: 주 버튼 · 보조 ── */
type BtnProps = {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  /** 위치: 기본 696, 보조와 함께면 two(620) */
  two?: boolean;
  top?: number;
  /** w = 흰 면(초록·빨강 바탕 위), idle = 옅은 면 + › , al = 알람(높이 112, 680) */
  kind?: 'ink' | 'w' | 'idle' | 'al';
  /** 아래에서 올라오는 시각(초). 없으면 바로 */
  up?: number;
};
export function Btn({ label, icon, onPress, two, top, kind = 'ink', up }: BtnProps) {
  const al = kind === 'al';
  const h = al ? 112 : 96;
  const bg = kind === 'w' ? C.white : kind === 'idle' ? C.tint : C.ink;
  const fg = kind === 'w' || kind === 'idle' ? C.ink : C.paper;
  const btn = (
    <Tap
      onPress={onPress}
      style={[
        abs({ left: 28, right: 28, top: top ?? (al ? 680 : two ? 620 : 696), height: h }),
        // 6판: 알약형 대신 둥근 사각형 (주 버튼 20, 알람 24)
        { borderRadius: al ? 24 : R.l, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
        kind === 'idle' && { justifyContent: 'space-between', paddingLeft: 40, paddingRight: 24, gap: 0 },
      ]}
    >
      <Color c={fg}>
        {icon && <Icon name={icon} size={40} />}
        <T s={32} k lh={1}>
          {label}
        </T>
        {kind === 'idle' && <Icon name="chevron-right" />}
      </Color>
    </Tap>
  );
  return up == null ? btn : <Up delay={up}>{btn}</Up>;
}

export function Sub({ label, icon, onPress, up }: { label: string; icon?: IconName; onPress?: () => void; up?: number }) {
  const sub = (
    <Tap
      onPress={onPress}
      style={[abs({ left: 28, right: 28, top: 740, height: 60 }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
    >
      {icon && <Icon name={icon} size={24} />}
      <T k>{label}</T>
    </Tap>
  );
  return up == null ? sub : <Up delay={up}>{sub}</Up>;
}

/** 원인 배지: 검은 원 56 안의 흰 아이콘. 그림이 자리잡은 뒤(0.3s) 튀어나온다. blink = 두 번 깜빡, beat = 계속 맥박 */
export function Badge({ icon, left = 306, top = 132, delay = 0.3, blink, beat }: { icon: IconName; left?: number; top?: number; delay?: number; blink?: boolean; beat?: boolean }) {
  const [v] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion() || !(blink || beat)) return;
    const t = (to: number, ms: number) => Animated.timing(v, { toValue: to, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: native });
    const a = blink
      ? Animated.sequence([Animated.delay((delay + 0.7) * 1000), Animated.loop(Animated.sequence([t(0, 175), t(1, 175)]), { iterations: 2 })])
      : Animated.sequence([Animated.delay((delay + 0.7) * 1000), Animated.loop(Animated.sequence([t(1.18, 320), t(1, 320), Animated.delay(960)]))]);
    a.start();
    return () => a.stop();
  }, [v, blink, beat, delay]);
  return (
    <Pop delay={delay * 1000} style={abs({ left, top, width: 56, height: 56 })}>
      <Animated.View style={[{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }, blink ? { opacity: v } : beat ? { transform: [{ scale: v }] } : null]}>
        <Icon name={icon} c={C.white} />
      </Animated.View>
    </Pop>
  );
}

/** 멈춤 손: 보호자에게 알린 오복용은 흰 원 88 + 빨간 손(화면 전체 빨강 위), 알림이 없는 안내는 먹 손 56 */
export function Stop({ ink }: { ink?: boolean }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    // 튀어나온 뒤 한 번 흔들린다(mv-shake .5s, .7s)
    const a = Animated.sequence([Animated.delay(700), Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.sin), useNativeDriver: native })]);
    a.start();
    return () => a.stop();
  }, [v]);
  const rotate = v.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: ['0deg', '-14deg', '12deg', '-8deg', '4deg', '0deg'] });
  if (ink)
    return (
      <Pop delay={200} style={abs({ left: 306, top: 132 })}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Icon name="hand" size={56} c={C.ink} />
        </Animated.View>
      </Pop>
    );
  return (
    <Pop delay={200} style={abs({ left: 274, top: 116, width: 88, height: 88 })}>
      <Animated.View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', transform: [{ rotate }] }}>
        <Icon name="hand" size={48} c={C.wrong} />
      </Animated.View>
    </Pop>
  );
}

/* ── 판정 틀: 그림 132–372 · 제목 420 · 지시 474 · 한 줄 508 ── */
/** 판정·실패 그림 자리. 이름이 조각 그림(예: 'verdict-ok@240')이면 PNG 조각 + 부분 움직임 */
export function Fig({ fig, motion, name, ...pos }: { fig?: string; motion?: Parameters<typeof Fig3>[0]['motion']; name?: IllName } & Pos) {
  const p = { left: 28, top: 132, width: 334, height: 240, ...pos };
  const v = useOnce(0, 0.36);
  return (
    <Animated.View style={[abs({ left: p.left, top: p.top, width: p.width, height: p.height }), { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
      {fig ? <Fig3 name={fig} motion={motion} w={p.width} h={p.height} /> : name ? <Ill name={name} w={p.width} h={p.height} /> : null}
    </Animated.View>
  );
}

/** 판정 글: 제목·지시·한 줄. mv = 판정 화면처럼 차례로 올라온다(.12 · .2 · .26s) */
export function Verdict({ title, tell, line, lineIcon, readAloud, top = 420, tellTop = 474, mv = true }: {
  title: string;
  tell?: string;
  line?: string;
  lineIcon?: IconName;
  readAloud?: boolean;
  top?: number;
  tellTop?: number;
  mv?: boolean;
}) {
  const fg = useFg();
  const sub = fg === C.ink ? C.ink2 : fg;
  const d = (n: number) => (mv ? n : 0);
  return (
    <>
      {readAloud && <Say text={[title, tell, line].filter(Boolean).join('. ')} />}
      <Up delay={d(0.12)}>
        <T h center top={top}>
          {title}
        </T>
      </Up>
      {tell && (
        <Up delay={d(0.2)}>
          <T k center top={tellTop}>
            {tell}
          </T>
        </Up>
      )}
      {line && (
        <Up delay={d(0.26)}>
          <Row center top={508}>
            {lineIcon && <Icon name={lineIcon} size={24} c={sub} />}
            <T c={sub}>{line}</T>
          </Row>
        </Up>
      )}
    </>
  );
}

/** 맞아요: 흰 고리가 한 번 퍼진다 */
export function Burst() {
  const v = useOnce(0.1, 0.8);
  if (reduceMotion()) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        abs({ left: 75, top: 132, width: 240, height: 240 }),
        { borderRadius: 120, borderWidth: 6, borderColor: C.white, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.5] }) }] },
      ]}
    />
  );
}

/* ── 하루 = 약통 칸 (7판, 사용자 확정): 세 칸 한 통 ── */
export type Slot = 'done' | 'plan' | 'missed' | 'nomed' | 'wrong' | 'none';
const SLOT_T = [0.176, 0.441, 0.8235];
const SLOT_ICON: IconName[] = ['sunrise', 'sun', 'moon'];
const SLOT_PILLS: IllName[][] = [
  ['pill-capsule', 'pill-round-blue'],
  ['pill-capsule', 'pill-round-blue'],
  ['pill-capsule', 'pill-round-blue', 'pill-scored'],
];
type TrayProps = {
  /** 아침·점심·저녁 상태. 빈 배열이면 빈 칸(점선 자리) */
  slots?: Slot[];
  /** 지금 시각의 위치 0–1 (f 가 없을 때 연한 회색 칸을 고른다) */
  now: number;
  /** 지금 볼 칸. 해야 할 칸이면 노랑, 아니면 연한 회색 */
  f?: number;
  /** 지금 할 칸(알약을 크게 · 노랑) */
  cur?: number;
  /** 보호자 현황의 작은 통(위 128, 높이 128) */
  small?: boolean;
};
/**
 * 먹은 칸은 알약이 빠진 뒤 체크, 예정 칸은 알약이 들어 있고, 해야 할 칸(지금·미복용·오복용)만 노랑, 다음 칸은 연한 회색.
 * 움직임: 칸이 왼쪽부터 뜨고(.1s 간격 .08) → 지금 칸에 노랑이 번지고(.45s) → 먹은 칸 알약이 빠지고 체크(.3 · .55s) → 표시가 뜬다
 */
export function Tray({ slots = [], now, f, cur, small }: TrayProps) {
  const x0 = 28;
  const y0 = small ? 128 : 150;
  const w = 334;
  const H = small ? 128 : 150;
  const k = H / 150;
  const cw = w / 3;
  const cx = (i: number) => x0 + cw * (i + 0.5);
  const on = (q?: Slot) => q != null && q !== 'none';
  const bad = (i: number) => slots[i] === 'missed' || slots[i] === 'nomed' || slots[i] === 'wrong';
  const hot = new Set<number>();
  let tint = -1;
  if (f != null) {
    if (on(slots[f])) {
      if (cur === f || bad(f)) hot.add(f);
      else tint = f;
    }
  } else {
    slots.forEach((_, i) => bad(i) && hot.add(i));
    if (!hot.size) tint = slots.findIndex((v, i) => v === 'plan' && SLOT_T[i] >= now - 0.06);
  }
  const focus = (i: number) => (f != null ? f === i : hot.has(i) || tint === i);
  const wipe = useOnce(0.45, 0.4);
  return (
    <View style={abs({ left: 0, top: 0, width: W, height: y0 + H + 8 })} pointerEvents="none">
      {[...hot].map((i) => (
        <Animated.View
          key={'h' + i}
          style={[
            abs({ left: x0 + cw * i + 3, top: y0 + 3, width: cw - 6, height: H - 6 }),
            { borderRadius: 24 * k, backgroundColor: 'rgba(255,196,33,0.42)', opacity: wipe, transformOrigin: 'left', transform: [{ scaleX: wipe }] },
          ]}
        />
      ))}
      {tint >= 0 && <View style={[abs({ left: x0 + cw * tint + 3, top: y0 + 3, width: cw - 6, height: H - 6 }), { borderRadius: 24 * k, backgroundColor: C.tint }]} />}
      <Svg width={W} height={y0 + H + 8} style={abs({ left: 0, top: 0 })}>
        <Rect x={x0} y={y0} width={w} height={H} rx={30 * k} fill="none" stroke={C.ink} strokeWidth={3} />
        <Path d={`M${x0 + cw} ${y0 + 4}V${y0 + H - 4}M${x0 + 2 * cw} ${y0 + 4}V${y0 + H - 4}`} stroke={C.ink} strokeWidth={3} strokeLinecap="round" />
        {[0, 1, 2].map((i) => !on(slots[i]) && <Circle key={i} cx={cx(i)} cy={y0 + 92 * k} r={24 * k} fill="none" stroke={C.plan} strokeWidth={3} strokeDasharray="1 9" strokeLinecap="round" />)}
      </Svg>
      {[0, 1, 2].map((i) => (
        <Cell key={i} i={i} v={slots[i]} c={cx(i)} y0={y0} k={k} focus={focus(i)} big={cur === i} />
      ))}
    </View>
  );
}

function Cell({ i, v, c, y0, k, focus, big }: { i: number; v?: Slot; c: number; y0: number; k: number; focus: boolean; big: boolean }) {
  const rise = useOnce(0.1 + 0.08 * i, 0.4);
  const out = useOnce(0.3, 0.4);
  const ck = useOnce(0.55, 0.4);
  const gl = useOnce(v === 'plan' ? 0.5 + 0.1 * i : 0.55, 0.4);
  // 미복용·약 없음은 두 번 흐려지고, 오복용은 한 번 흔들린다
  const [after] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion() || !(v === 'missed' || v === 'nomed' || v === 'wrong')) return;
    const t = (to: number, ms: number) => Animated.timing(after, { toValue: to, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: native });
    const a = Animated.sequence([Animated.delay(1100), v === 'wrong' ? t(1, 500) : Animated.loop(Animated.sequence([t(1, 500), t(0, 500)]), { iterations: 2 })]);
    a.start();
    return () => a.stop();
  }, [after, v]);
  const my = y0 + 92 * k;
  const ic = 32 * k;
  const pop = (a: Animated.Value) => ({ opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] });
  let mark: ReactNode = null;
  if (v === 'done') {
    const z = 52 * k;
    mark = (
      <>
        {!reduceMotion() && (
          <Animated.View style={[abs({ left: c - 22 * k, top: my - 22 * k }), { opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: out.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }) }] }]}>
            <Ill name="pill-capsule" w={44 * k} />
          </Animated.View>
        )}
        <Animated.View style={[abs({ left: c - z / 2, top: my - z / 2 }), pop(ck)]}>
          <StatusMark s="done" size={z} />
        </Animated.View>
      </>
    );
  } else if (v === 'missed' || v === 'nomed' || v === 'wrong') {
    const z = 60 * k;
    const extra =
      v === 'wrong'
        ? { transform: [{ translateX: after.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -4, 4, -3, 2, 0] }) }] }
        : { opacity: after.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) };
    mark = (
      <Animated.View style={[abs({ left: c - z / 2, top: my - z / 2 }), pop(gl)]}>
        <Animated.View style={extra}>
          <StatusMark s={v === 'wrong' ? 'wrong' : 'missed'} size={z} />
        </Animated.View>
      </Animated.View>
    );
  } else if (v === 'plan') {
    const a = SLOT_PILLS[i];
    const z = (big ? 40 : a.length > 2 ? 30 : 36) * k;
    const g = 4 * k;
    const tw = a.length * z + (a.length - 1) * g;
    mark = (
      <Animated.View style={[abs({ left: c - tw / 2, top: my - z / 2 }), { flexDirection: 'row', gap: g }, pop(gl)]}>
        {a.map((n, j) => (
          <Ill key={j} name={n} w={z} />
        ))}
      </Animated.View>
    );
  }
  return (
    <>
      <Animated.View style={[abs({ left: c - ic / 2, top: y0 + 16 * k }), { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
        <Icon name={SLOT_ICON[i]} size={ic} c={focus ? C.ink : C.plan} />
      </Animated.View>
      {mark}
    </>
  );
}

/** 허브 아래 알약 줄 (504): 알약 그림 · 개수 · 식전/식후. 한 알씩 놓인다(몇 알인지 눈으로 센다) */
export function Pills({ pills, count, meal, miss, up = 0.75 }: { pills: IllName[]; count: string; meal: string; /** 빠진 자리(깜빡인다) */ miss?: number; up?: number }) {
  return (
    <Up delay={up}>
      <Row center top={504} style={{ height: 72 }}>
        {pills.map((p, i) => (
          <Pop key={i} delay={250 + i * 90}>
            {i === miss ? <Blink times={3} delay={0.9}><Ill name={p} /></Blink> : <Ill name={p} />}
          </Pop>
        ))}
        <T s={32} k>
          {count}
        </T>
        <T c={C.ink2} style={{ marginLeft: 16 }}>
          {meal}
        </T>
      </Row>
    </Up>
  );
}

/** 빠진 자리·주의: 옅어졌다 돌아오기를 times 번 (vk-pulse .8s) */
export function Blink({ times, delay, children }: { times: number; delay: number; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion()) return;
    const t = (to: number) => Animated.timing(v, { toValue: to, duration: 400, easing: Easing.inOut(Easing.sin), useNativeDriver: native });
    const a = Animated.sequence([Animated.delay(delay * 1000), Animated.loop(Animated.sequence([t(0.2), t(1)]), { iterations: times })]);
    a.start();
    return () => a.stop();
  }, [v, times, delay]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

/* ── 카메라 (7판: 보는 창 = 폰 카메라 기본 3:4 를 화면 폭 그대로, 390×520 · top 152) ── */
const CORNERS = 'M16 68V44A28 28 0 0 1 44 16h24M322 16h24a28 28 0 0 1 28 28v24M374 452v24a28 28 0 0 1-28 28h-24M68 504H44a28 28 0 0 1-28-28v-24';

/** 윗줄 가운데: 무엇을 찍는지(66) · 안내(112) */
export function CamTitle({ icon, title, tell, warn, top = 66 }: { icon: IconName; title: string; tell?: string; warn?: boolean; top?: number }) {
  return (
    <>
      <Row center top={top}>
        <Icon name={icon} />
        <T s={32} k>
          {title}
        </T>
      </Row>
      {tell && (
        <T k center top={112} c={warn ? C.sun : undefined}>
          {tell}
        </T>
      )}
    </>
  );
}

/**
 * 보는 창. 실제 카메라가 붙기 전까지는 예시 사진을 보여 준다.
 * guide = 놓을 자리 윤곽(위 약포, 아래 손바닥)이 천천히 깜빡인다. lock = 셔터를 누른 뒤 모서리 괄호가 노랑으로 잠긴다(1.8s, 한 번)
 */
export function Viewfinder({ photo, dark, guide, off, lock = 1.8 }: { photo?: IllName; dark?: boolean; guide?: boolean; off?: boolean; lock?: number | null }) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!guide || reduceMotion()) return;
    const t = (to: number) => Animated.timing(pulse, { toValue: to, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: native });
    const a = Animated.sequence([Animated.delay(400), Animated.loop(Animated.sequence([t(1), t(0)]))]);
    a.start();
    return () => a.stop();
  }, [pulse, guide]);
  const lk = useShutterLock(lock);
  return (
    <View style={abs({ left: 0, top: 152, width: 390, height: 520 })}>
      {off ? <View style={{ width: 390, height: 520, backgroundColor: '#1E1E1E' }} /> : photo && <Ill name={photo} w={390} h={520} />}
      {dark && <View style={[abs({ left: 0, top: 0, width: 390, height: 520 }), { backgroundColor: '#000', opacity: 0.72 }]} />}
      {guide && (
        <Animated.View style={[abs({ left: 0, top: 0 }), { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }) }]}>
          <Svg width={390} height={520}>
            <Rect x={12} y={201} width={161} height={139} rx={24} fill="none" stroke="#fff" strokeWidth={3} strokeDasharray="1 10" strokeLinecap="round" />
            <Path d={ellipse(282, 240, 98, 152, -7)} fill="none" stroke="#fff" strokeWidth={3} strokeDasharray="1 10" strokeLinecap="round" />
          </Svg>
        </Animated.View>
      )}
      {guide && (
        <>
          <GuideWord x={92} y={190} w="봉투" />
          <GuideWord x={280} y={430} w="손바닥" />
        </>
      )}
      <Svg width={390} height={520} style={abs({ left: 0, top: 0 })}>
        <Path d={CORNERS} fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      {lk && (
        // 모서리 괄호: 흰색 → 노랑으로 잠기며 살짝 조였다 풀린다(iPhone 초점 잠금)
        <Animated.View style={[abs({ left: 0, top: 0 }), { opacity: lk.interpolate({ inputRange: [0, 0.1, 0.3, 1], outputRange: [0, 0, 1, 1] }), transform: [{ scale: lk.interpolate({ inputRange: [0, 0.1, 0.3, 0.6, 1], outputRange: [1, 1, 0.95, 1, 1] }) }] }]}>
          <Svg width={390} height={520}>
            <Path d={CORNERS} fill="none" stroke={C.sun} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      )}
      {lk && (
        // 화면이 한 번 어두워졌다 돌아온다(iOS 셔터)
        <Animated.View pointerEvents="none" style={[abs({ left: 0, top: 0, width: 390, height: 520 }), { backgroundColor: '#000', opacity: lk.interpolate({ inputRange: [0, 0.06, 0.12, 0.26, 1], outputRange: [0, 0, 0.88, 0, 0] }) }]} />
      )}
    </View>
  );
}
/** 기울어진 타원 경로 (SVG ellipse + rotate 를 한 경로로) */
function ellipse(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const p = (t: number) => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return `${(cx + x * Math.cos(a) - y * Math.sin(a)).toFixed(1)} ${(cy + x * Math.sin(a) + y * Math.cos(a)).toFixed(1)}`;
  };
  return `M${p(0)}A${rx} ${ry} ${deg} 1 1 ${p(Math.PI)}A${rx} ${ry} ${deg} 1 1 ${p(0)}Z`;
}
/** 윤곽 안 낱말: 밝은 사진 위에서도 읽히게 어두운 그림자 위 흰 글자 */
function GuideWord({ x, y, w }: { x: number; y: number; w: string }) {
  return (
    <T s={24} k c={C.white} style={{ position: 'absolute', left: x - 60, width: 120, top: y - 24, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}>
      {w}
    </T>
  );
}

/** 셔터를 누른 장면(1.8s 에 한 번): 0 → 1 이 1.2s 동안 */
function useShutterLock(at: number | null) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (at == null || reduceMotion()) return;
    const a = Animated.timing(v, { toValue: 1, duration: 1200, delay: at * 1000, easing: Easing.linear, useNativeDriver: native });
    a.start();
    return () => a.stop();
  }, [v, at]);
  return at == null || reduceMotion() ? null : v;
}

/** 셔터 (6판): 흰 면 원 + 검은 6 테두리 + 흰 4 바깥 선, 글자 없음. 누르면 안쪽 흰 원이 줄어든다(테두리 16) */
export function Shutter({ onPress, at = 1.8 }: { onPress?: () => void; at?: number | null }) {
  const [pressed, setPressed] = useState(false);
  const lk = useShutterLock(at);
  const ring = lk ? lk.interpolate({ inputRange: [0, 0.08, 0.3, 1], outputRange: [0, 1, 0, 0] }) : null;
  return (
    <Tap
      accessibilityLabel="찍기"
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[abs({ left: 139, top: 696, width: 112, height: 112 }), { borderRadius: 56, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' }]}
    >
      <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: C.cam, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            width: 92,
            height: 92,
            borderRadius: 46,
            backgroundColor: C.white,
            transform: [{ scale: pressed ? 72 / 92 : ring ? ring.interpolate({ inputRange: [0, 1], outputRange: [1, 72 / 92] }) : 1 }],
          }}
        />
      </View>
    </Tap>
  );
}

/** 손전등 (p06b): 노랑, 천천히 맥박 */
export function Torch() {
  const [v] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion()) return;
    const t = (to: number, ms: number) => Animated.timing(v, { toValue: to, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: native });
    const a = Animated.sequence([Animated.delay(500), Animated.loop(Animated.sequence([t(1.18, 300), t(1, 300), Animated.delay(900)]))]);
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Tap accessibilityLabel="손전등" style={[abs({ left: 28, top: 720, width: 64, height: 64 }), { borderRadius: 32, alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={{ transform: [{ scale: v }] }}>
        <Icon name="flashlight" size={40} c={C.sun} />
      </Animated.View>
    </Tap>
  );
}

/** 촬영 화면 위로 올라온 시트 (p14 카메라 꺼짐). 안의 좌표는 화면 기준 그대로 */
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <>
      <View style={[abs({ left: 0, right: 0, top: 420, bottom: 0 }), { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl }]} />
      <Color c={C.ink}>{children}</Color>
    </>
  );
}

/* ── 읽는 중·보는 중: 글자 분석 모션 (7판) ── */
/** 사진 좌표(300×400) 위 표시. glint = 라인이 지날 때 비치는 자리, mark = 응답이 오면 긋는 밑줄·동그라미 */
export type ScanSpec = {
  photo: IllName;
  /** 비침: SVG 도형 마크업(사진 좌표) · 시작(s) */
  glints: [string, number][];
  /** 모서리 괄호: 경로 · 회전 · 붙는 시각(s) */
  frame: { d: string; rotate: string; at: number };
  /** 밑줄·동그라미: SVG 도형 마크업 · 시작(s) */
  marks: [string, number][];
  /** 아래 빈 칸: 그림 · 윤곽이 진해지는 시각 · 그림이 떨어지는 시각 */
  slots: [IllName, number, number][];
};
const CARD = { left: 75, top: 150, w: 240, h: 320, s: 0.8 };
/**
 * 찍은 사진(3:4 그대로)이 보는 창 크기에서 카드로 내려앉고(.3s), 노란 스캔 라인이 위→아래로 1.8s 훑고 0.4s 쉬고 한 번 더.
 * 라인이 지나는 글줄이 비쳤다 사라지고, 첫 훑기 끝에 모서리 괄호가 고정, 아래 빈 칸 윤곽이 1초 간격으로 진해진다.
 * 응답이 오는 장면(4.45s)에 밑줄·동그라미 → 칸에 그림이 떨어진다.
 */
export function ScanCard({ spec, title }: { spec: ScanSpec; title: string }) {
  const land = useOnce(0, 0.3, STD);
  const [scan] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    const a = Animated.sequence([Animated.delay(350), Animated.loop(Animated.timing(scan, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: native }), { iterations: 2, resetBeforeIteration: true })]);
    a.start();
    return () => a.stop();
  }, [scan]);
  const s = CARD.s;
  return (
    <>
      <Animated.View
        style={[
          abs({ left: CARD.left, top: CARD.top, width: CARD.w, height: CARD.h }),
          { transform: [{ translateY: land.interpolate({ inputRange: [0, 1], outputRange: [102, 0] }) }, { scale: land.interpolate({ inputRange: [0, 1], outputRange: [1.625, 1] }) }] },
        ]}
      >
        <View style={{ width: CARD.w, height: CARD.h, borderRadius: 34 * s, overflow: 'hidden' }}>
          <Ill name={spec.photo} w={CARD.w} h={CARD.h} />
          {spec.glints.map(([m, d], i) => (
            <Glint key={i} markup={m} delay={d} />
          ))}
          {!reduceMotion() && (
            <Animated.View
              style={[
                abs({ left: 0, top: 0, width: CARD.w, height: 72 * s }),
                {
                  opacity: scan.interpolate({ inputRange: [0, 0.818, 0.82, 1], outputRange: [1, 1, 0, 0] }),
                  transform: [{ translateY: scan.interpolate({ inputRange: [0, 0.818, 1], outputRange: [-96 * s, 408 * s, 408 * s] }) }],
                },
              ]}
            >
              <Svg width={CARD.w} height={72 * s}>
                <Defs>
                  <LinearGradient id="scg" x1="0" y1="0" x2="0" y2="1">
                    <SvgStop offset="0" stopColor={C.sun} stopOpacity={0} />
                    <SvgStop offset="1" stopColor={C.sun} stopOpacity={0.38} />
                  </LinearGradient>
                </Defs>
                <Rect width={CARD.w} height={72 * s} fill="url(#scg)" />
                <Rect y={(72 - 3.5) * s} width={CARD.w} height={7 * s} fill={C.sun} />
              </Svg>
            </Animated.View>
          )}
        </View>
        <Frame d={spec.frame.d} rotate={spec.frame.rotate} at={spec.frame.at} />
        {spec.marks.map(([m, d], i) => (
          <Mark key={i} markup={m} delay={d} />
        ))}
      </Animated.View>
      <Up delay={0.3}>
        <T s={32} k center top={496}>
          {title}
        </T>
      </Up>
      <Up delay={0.4}>
        <T c={C.ink2} center top={536}>
          잠시만요
        </T>
      </Up>
      <View style={[abs({ left: 0, right: 0, top: 612 }), { flexDirection: 'row', justifyContent: 'center', gap: 24 }]}>
        {spec.slots.map(([n, o, d], i) => (
          <ScanSlot key={i} name={n} outline={o} drop={d} />
        ))}
      </View>
    </>
  );
}
const xmlOf = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">${inner}</svg>`;
function Glint({ markup, delay }: { markup: string; delay: number }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    // sc-glint 2.2s × 2: 4% 에 .5 까지, 36% 에 사라짐
    const one = Animated.sequence([
      Animated.timing(v, { toValue: 0.5, duration: 88, useNativeDriver: native }),
      Animated.timing(v, { toValue: 0, duration: 704, easing: Easing.out(Easing.quad), useNativeDriver: native }),
      Animated.delay(1408),
    ]);
    const a = Animated.sequence([Animated.delay(delay * 1000), one, one]);
    a.start();
    return () => a.stop();
  }, [v, delay]);
  return (
    <Animated.View pointerEvents="none" style={[abs({ left: 0, top: 0 }), { opacity: v }]}>
      <SvgFrom xml={xmlOf(`<g fill="${C.sun}">${markup}</g>`)} />
    </Animated.View>
  );
}
function Frame({ d, rotate, at }: { d: string; rotate: string; at: number }) {
  const v = useOnce(at, 0.35, STD);
  return (
    <Animated.View pointerEvents="none" style={[abs({ left: 0, top: 0 }), { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }] }]}>
      <SvgFrom xml={xmlOf(`<g transform="${rotate}"><path d="${d}" fill="none" stroke="${C.sun}" stroke-width="6" stroke-linecap="round"/></g>`)} />
    </Animated.View>
  );
}
function Mark({ markup, delay }: { markup: string; delay: number }) {
  // 목업은 선이 그어진다(stroke-dashoffset). 앱은 0.3s 에 나타남으로 대신한다
  const v = useOnce(delay, 0.3, STD);
  return (
    <Animated.View pointerEvents="none" style={[abs({ left: 0, top: 0 }), { opacity: v }]}>
      <SvgFrom xml={xmlOf(`<g fill="none" stroke="${C.sun}" stroke-width="6" stroke-linecap="round">${markup}</g>`)} />
    </Animated.View>
  );
}
function SvgFrom({ xml }: { xml: string }) {
  return <SvgXmlBox xml={xml} />;
}
function ScanSlot({ name, outline, drop }: { name: IllName; outline: number; drop: number }) {
  const o = useOnce(outline, 0.3, Easing.out(Easing.quad), false);
  const d = useOnce(drop, 0.5);
  return (
    <Animated.View
      style={{
        width: 76,
        height: 76,
        borderRadius: 38,
        borderWidth: 3,
        borderStyle: 'dotted',
        borderColor: o.interpolate({ inputRange: [0, 1], outputRange: [C.line, C.ink] }) as unknown as string,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View style={{ opacity: d, transform: [{ translateY: d.interpolate({ inputRange: [0, 0.6, 0.8, 1], outputRange: [-70, 6, -3, 0] }) }] }}>
        <Ill name={name} w={64} />
      </Animated.View>
    </Animated.View>
  );
}

/* ── 잠금 화면 (8판: 중성 회색 + 옅은 흰 점 무늬) · 리퀴드 글래스 알림 ── */
/** 회색 바탕 #4A4A4C 위 22px 간격 흰 점. 목업은 이 무늬가 카드 가장자리에서 렌즈처럼 휜다(앱은 굴절 없이 비침만) */
function Dots({ w, h, radius = 0 }: { w: number; h: number; radius?: number }) {
  return (
    <Svg width={w} height={h} style={abs({ left: 0, top: 0 })}>
      <Defs>
        <Pattern id="dots" width={22} height={22} patternUnits="userSpaceOnUse">
          <Circle cx={0} cy={0} r={2.6} fill="rgba(255,255,255,0.22)" />
          <Circle cx={22} cy={0} r={2.6} fill="rgba(255,255,255,0.22)" />
          <Circle cx={0} cy={22} r={2.6} fill="rgba(255,255,255,0.22)" />
          <Circle cx={22} cy={22} r={2.6} fill="rgba(255,255,255,0.22)" />
        </Pattern>
      </Defs>
      <Rect width={w} height={h} rx={radius} fill={C.lock} />
      <Rect width={w} height={h} rx={radius} fill="url(#dots)" />
    </Svg>
  );
}
export function Lock({ time, children }: { time: string; children: ReactNode }) {
  return (
    <>
      <Dots w={390} h={844} />
      <T s={84} num center top={116}>
        {time}
      </T>
      <T s={20} c={C.nightt} center top={208}>
        {TODAY_LONG}
      </T>
      {children}
    </>
  );
}

/** 위에서 내려오는 알림 카드(목업 ak-noti .45s, .15s) */
function useNotiDrop() {
  return useOnce(0.15, 0.45);
}
/** 유리 면: 은회색 그러데이션 + 가는 흰 테두리 + 떠 있는 그림자. 뒤 무늬가 비친다 */
function Glass({ radius, children, bg }: { radius: number; children?: ReactNode; bg?: boolean }) {
  return (
    <View
      style={[
        abs({ left: 0, top: 0, right: 0, bottom: 0 }),
        { borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', boxShadow: '0 24px 40px -14px rgba(0,0,0,0.45)', zIndex: -1 },
      ]}
    >
      <GlassFill radius={radius} bg={bg} />
      {children}
    </View>
  );
}
function GlassFill({ radius, bg }: { radius: number; bg?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View style={abs({ left: 0, top: 0, right: 0, bottom: 0 })} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.w > 0 && (
        <>
          {bg && <Dots w={size.w} h={size.h} radius={radius} />}
          <Svg width={size.w} height={size.h} style={abs({ left: 0, top: 0 })}>
            <Defs>
              <LinearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
                <SvgStop offset="0" stopColor="rgb(226,230,242)" stopOpacity={0.34} />
                <SvgStop offset="0.55" stopColor="rgb(140,144,158)" stopOpacity={0.24} />
                <SvgStop offset="1" stopColor="rgb(176,180,194)" stopOpacity={0.3} />
              </LinearGradient>
            </Defs>
            <Rect width={size.w} height={size.h} rx={radius} fill="url(#glass)" />
            {/* 빛 방향 테두리: 왼쪽 위가 가장 밝다 */}
            <Path d={`M${radius} 0.75H${size.w * 0.5}M0.75 ${radius}V${size.h * 0.4}`} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeLinecap="round" />
          </Svg>
        </>
      )}
    </View>
  );
}
/** 흰 버튼(찍기·전화하기): 목업은 위가 밝은 흰 그러데이션. 앱은 흰 면 + 아래 가장자리 어둠 + 떠 있는 그림자 */
const WHITE_FACE = { backgroundColor: '#F4F4F6', borderBottomWidth: 3, borderBottomColor: 'rgba(0,0,0,0.10)' } as const;

/** 복용자에게 가는 약 알림 (크게: 제목 32 · 찍기 80). preview = c05 미리 보기(누를 수 없음, 카드 안에 잠금 무늬) */
export function PillNoti({ when, title, body, onPress, preview, loud, top = 300 }: { when: string; title: string; body?: string; onPress?: () => void; preview?: boolean; loud?: boolean; top?: number }) {
  const v = useNotiDrop();
  return (
    <Animated.View style={[abs(preview ? { left: 28, right: 28, top } : { left: 8, right: 8, top }), { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-44, 0] }) }] }]}>
      <Tap card disabled={preview} accessibilityElementsHidden={preview} importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'} onPress={onPress} style={{ borderRadius: 32, padding: 20, gap: 8 }}>
        <Glass radius={32} bg={preview} />
        <Color c={C.white}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="pill" size={24} c="rgba(255,255,255,0.88)" />
            <T s={16} c="rgba(255,255,255,0.88)">
              약 알림 · {when}
            </T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Fig3 name="pouch-noon@64" motion={loud ? 'am-ring loud' : 'am-ring'} w={48} h={48} />
            <T s={32} k>
              {title}
            </T>
          </View>
          {body && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="volume-2" size={24} />
              <T k>{body}</T>
            </View>
          )}
          <Tap disabled={preview} onPress={onPress} style={{ marginTop: 16, height: 80, borderRadius: R.s, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, boxShadow: '0 10px 22px -4px rgba(0,0,0,0.5)', ...WHITE_FACE }}>
            <Icon name="camera" size={40} c={C.ink} />
            <T s={32} k lh={1} c={C.ink}>
              찍기
            </T>
          </Tap>
        </Color>
      </Tap>
    </Animated.View>
  );
}

/** 보호자 알림의 회차 줄 상태 (nomed = 약 없음, 미복용과 같은 마름모) */
export type RowSlot = 'done' | 'plan' | 'missed' | 'nomed' | 'wrong';
const ROW_LABEL: Record<RowSlot, string> = { done: '완료', missed: '응답 없음', nomed: '약 없음', wrong: '확인 필요', plan: '예정' };
/**
 * 회차 줄(보호자만): 칸 셋, 위 상태 모양 32(예정 = 알약 · 완료 = 체크 · 미복용/약 없음 = 마름모 · 오복용 = 세모), 아래 회차 그림 24.
 * f = 지금 칸(노랑 원 40 바탕), x = [칸, 모양] 작은 배지 16
 */
function DayRow({ s, f, x }: { s: RowSlot[]; f: number; x?: [number, Status] }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={s.map((k, i) => ['아침', '점심', '저녁'][i] + ' ' + ROW_LABEL[k] + (i === f ? '(지금)' : '') + (x && x[0] === i ? ', ' + ROW_LABEL[x[1] as RowSlot] : '')).join(', ')}
      style={{ marginVertical: 16, height: 64, flexDirection: 'row' }}
    >
      {s.map((k, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
          <Pop delay={300 + i * 140} style={{ width: 32, height: 32 }}>
            {i === f && <View style={[abs({ left: -4, top: -4, width: 40, height: 40 }), { borderRadius: 20, backgroundColor: C.sun, zIndex: -1 }]} />}
            {k === 'plan' ? <Ill name="pill-capsule" w={32} /> : <StatusMark s={k === 'nomed' ? 'missed' : k} size={32} />}
            {x && x[0] === i && <StatusMark s={x[1]} size={16} style={abs({ right: -8, bottom: -4 })} />}
          </Pop>
          <Icon name={SLOT_ICON[i]} size={24} c={i === f ? C.white : 'rgba(255,255,255,0.72)'} />
        </View>
      ))}
    </View>
  );
}

type NotiProps = {
  title: string;
  body: string;
  /** 오른쪽 큰 그림 48(Android largeIcon): 아이콘 · 상태 모양 · 그림 */
  big: ReactNode;
  row: { s: RowSlot[]; f: number; x?: [number, Status] };
  onPress?: () => void;
  /** 확인 · 전화하기. 없으면 행동 없는 알림(해결 알림) */
  onAck?: () => void;
  onCall?: () => void;
};
/** 보호자에게 가는 알림 한 장 (리퀴드 글래스, 31번 g11c 기준 버튼 한 줄) */
export function Noti({ title, body, big, row, onPress, onAck, onCall }: NotiProps) {
  const v = useNotiDrop();
  const li = useOnce(0.55, 0.42, Easing.bezier(0.3, 1.4, 0.5, 1));
  return (
    <Animated.View style={[abs({ left: 8, right: 8, top: 300 }), { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-44, 0] }) }] }]}>
      <Tap card onPress={onPress} style={{ borderRadius: R.xl, padding: 20, gap: 8 }}>
        <Glass radius={R.xl} />
        <Color c={C.white}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="pill" size={24} c="rgba(255,255,255,0.88)" />
            <T s={16} c="rgba(255,255,255,0.88)">
              약 알림 · 지금
            </T>
          </View>
          <Animated.View style={[abs({ right: 20, top: 48, width: 48, height: 48 }), { borderRadius: 24, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', opacity: li, transform: [{ scale: li }] }]}>
            <Color c={C.ink}>{big}</Color>
          </Animated.View>
          <T s={20} k style={{ paddingRight: 56, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }}>
            {title}
          </T>
          <T s={16} c="rgba(255,255,255,0.92)" style={{ paddingRight: 56 }}>
            {body}
          </T>
          <DayRow {...row} />
          {(onAck || onCall) && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Tap onPress={onAck} style={{ flex: 1, height: 56, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                <T s={16} k style={{ fontSize: 18 }}>
                  확인
                </T>
              </Tap>
              <Tap onPress={onCall} style={{ flex: 2, height: 56, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 8px 18px -4px rgba(0,0,0,0.45)', ...WHITE_FACE }}>
                <Icon name="phone" size={24} c={C.ink} />
                <T s={16} k c={C.ink} style={{ fontSize: 18 }}>
                  전화하기
                </T>
              </Tap>
            </View>
          )}
        </Color>
      </Tap>
    </Animated.View>
  );
}

/* ── 3D 폰 (02·04·08번) ── */
/**
 * 목업은 얇은 면 19장을 CSS 3D 로 쌓아 돌린다. RN 에는 preserve-3d 가 없어 앞면 한 장 + 뒤로 비키는 옆면 한 장을
 * perspective 회전(rotateY)으로 돌려 두께를 흉내 낸다. 움직임: 돌아 들어옴(.95s) → sway(좌우 흔들림 + 둥실) · shake(고개 저음) · ring(울림)
 */
export function Phone3D({ left, top, ry, r0 = -75, sw = 18, kind = 'sway', pills, ring, enter }: { left: number; top: number; ry: number; r0?: number; sw?: number; kind?: 'sway' | 'shake'; pills?: boolean; ring?: boolean; enter?: 'l' | 'r' }) {
  const spin = useOnce(0.05, kind === 'shake' ? 0.6 : 0.95, Easing.bezier(0.2, 0.8, 0.2, 1));
  const [loop] = useState(() => new Animated.Value(0));
  const [bob] = useState(() => new Animated.Value(0));
  const [buzz] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    const t = (v: Animated.Value, to: number, ms: number, e = Easing.inOut(Easing.sin)) => Animated.timing(v, { toValue: to, duration: ms, easing: e, useNativeDriver: native });
    const all: Animated.CompositeAnimation[] = [];
    if (kind === 'sway') {
      all.push(Animated.sequence([Animated.delay(1150), Animated.loop(Animated.sequence([t(loop, 1, 2600), t(loop, 0, 2600)]))]));
      all.push(Animated.sequence([Animated.delay(1100), Animated.loop(Animated.sequence([t(bob, 1, 1800), t(bob, 0, 1800)]))]));
    } else all.push(Animated.sequence([Animated.delay(750), t(loop, 1, 950)]));
    if (ring) all.push(Animated.sequence([Animated.delay(1150), Animated.loop(t(buzz, 1, 1100, Easing.linear), { iterations: 2, resetBeforeIteration: true })]));
    const a = Animated.parallel(all);
    a.start();
    return () => a.stop();
  }, [loop, bob, buzz, kind, ring]);
  const base = spin.interpolate({ inputRange: [0, 1], outputRange: [r0, ry] });
  const swing =
    kind === 'sway'
      ? loop.interpolate({ inputRange: [0, 1], outputRange: [0, sw] })
      : loop.interpolate({ inputRange: [0, 0.16, 0.36, 0.56, 0.76, 1], outputRange: [0, -26, 22, -14, 7, 0] });
  const rotY = Animated.add(base, swing).interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });
  const fade = useOnce(enter ? 0.1 : 0, enter ? 0.5 : 0.36);
  const side = ry < 0 ? 1 : -1;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        abs({ left, top, width: 160, height: 160 }),
        { opacity: fade, transform: [{ translateX: fade.interpolate({ inputRange: [0, 1], outputRange: [enter === 'l' ? -36 : enter === 'r' ? 36 : 0, 0] }) }] },
      ]}
    >
      <Animated.View
        style={[
          abs({ left: 44, top: 148, width: 72, height: 12 }),
          { borderRadius: 36, backgroundColor: 'rgba(23,21,15,0.12)', transform: [{ scaleX: bob.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }) }] },
        ]}
      />
      <Animated.View style={[abs({ left: 44, top: 12, width: 72, height: 136 }), { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }, { rotate: buzz.interpolate({ inputRange: [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 1], outputRange: ['0deg', '-5deg', '5deg', '-4deg', '4deg', '-2deg', '2deg', '0deg', '0deg'] }) }] }]}>
        <Animated.View style={{ width: 72, height: 136, transform: [{ perspective: 560 }, { rotateX: '-8deg' }, { rotateY: rotY }] }}>
          {/* 옆면: 회전 반대쪽으로 비켜 두께로 보인다 */}
          <View style={[abs({ left: side * 7, top: 2, width: 72, height: 136 }), { borderRadius: 14, backgroundColor: '#D6D6D6', borderWidth: 3, borderColor: '#17150F' }]} />
          <View style={[abs({ left: 0, top: 0, width: 72, height: 136 }), { borderRadius: 14, backgroundColor: C.white, borderWidth: 3, borderColor: '#17150F', alignItems: 'center' }]}>
            <View style={[abs({ left: 2, top: 2, width: 62, height: 126 }), { borderRadius: 9, backgroundColor: pills ? C.paper : C.tint }]} />
            <View style={[abs({ left: 30.6, top: 7.6, width: 4.8, height: 4.8 }), { borderRadius: 2.4, backgroundColor: '#17150F' }]} />
            <View style={[abs({ left: 24, top: 119.5, width: 18, height: 3 }), { borderRadius: 1.5, backgroundColor: '#17150F' }]} />
            {pills && (
              <>
                <Ill name="pill-capsule" w={44} style={abs({ left: 11, top: 28 })} />
                <Ill name="pill-round-blue" w={30} style={abs({ left: 18, top: 68 })} />
              </>
            )}
          </View>
        </Animated.View>
      </Animated.View>
      {ring && <RingWaves />}
    </Animated.View>
  );
}
/** 울리는 폰 왼쪽의 신호 호 두 줄: 세 번 깜빡 */
function RingWaves() {
  const [v] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion()) return;
    const t = (to: number) => Animated.timing(v, { toValue: to, duration: 275, useNativeDriver: native });
    const a = Animated.sequence([Animated.delay(1200), Animated.loop(Animated.sequence([t(0.2), t(1)]), { iterations: 3 })]);
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Animated.View style={[abs({ left: 0, top: 0 }), { opacity: v }]}>
      <Svg width={160} height={160}>
        <Path d="M32 52q-9 28 0 56M18 40q-14 40 0 80" stroke="#17150F" strokeWidth={3} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** SvgXml 을 카드 크기(240×320) 상자로 */
function SvgXmlBox({ xml }: { xml: string }) {
  return <SvgXml xml={xml} width={CARD.w} height={CARD.h} />;
}
