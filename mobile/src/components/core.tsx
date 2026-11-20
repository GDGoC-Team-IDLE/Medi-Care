// 바탕 부품: 화면 틀(Phone), 글(T), 아이콘(Icon), 삽화(Ill), 누름(Tap)
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ICONS, ILLUST, type IconName, type IllName } from '@/constants/assets.gen';
import { PNG, SYMBOL_PNG } from '@/constants/img.gen';
import { C, H, W } from '@/constants/theme';

export type { IconName, IllName };

// 글·아이콘의 기본 색 (CSS 의 color 상속을 대신한다)
const Fg = createContext<string>(C.ink);
export const useFg = () => useContext(Fg);
export function Color({ c, children }: { c: string; children: ReactNode }) {
  return <Fg.Provider value={c}>{children}</Fg.Provider>;
}

/* ── 움직임 ── */
/** '동작 줄이기'가 켜져 있으면 자리 이동·맥박을 뺀다(흐려짐만 남긴다). */
let reduce = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => (reduce = v))
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => (reduce = v));
export const reduceMotion = () => reduce;
const native = Platform.OS !== 'web';

/** 뒤로/닫기가 있는 화면인지: 없는 화면은 개발용 목록 단추가 그 자리를 채운다. */
const BackSlot = createContext<(on: boolean) => void>(() => {});
export const useBackSlot = () => useContext(BackSlot);

/** 390×844 목업 좌표를 그대로 쓰는 화면 틀. 기기 크기에 맞춰 같은 비율로 늘린다. */
export function Phone({
  bg = C.paper,
  fg = C.ink,
  children,
}: {
  bg?: string;
  fg?: string;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const s = Math.min(width / W, height / H);
  const [hasBack, setHasBack] = useState(false);
  // 들어올 때: 바탕은 그대로, 내용만 살짝 올라오며 나타난다
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [enter]);
  return (
    <View
      // 빈 곳을 누르면 자판을 내린다
      onStartShouldSetResponder={() => {
        Keyboard.dismiss();
        return false;
      }}
      style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      <StatusBar style={fg === C.ink ? 'dark' : 'light'} />
      {/*
        목업 390×844 좌표를 기기 크기로 늘린다. 기기(네이티브)는 transform scale 로도 선명하지만,
        웹은 transform 으로 늘린 층을 비트맵으로 늘려 누르거나 움직일 때 글자·그림이 흐려진다.
        그래서 웹은 CSS zoom 으로 늘려 처음부터 그 크기로 다시 그리게 한다.
      */}
      <View style={(native ? { width: W, height: H, transform: [{ scale: s }] } : { width: W, height: H, zoom: s }) as ViewStyle}>
        <Animated.View
          style={{
            width: W,
            height: H,
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 0 : 12, 0] }) }],
          }}
        >
          <Fg.Provider value={fg}>
            <BackSlot.Provider value={setHasBack}>
              {children}
              {__DEV__ && !native && !hasBack && <DevList />}
            </BackSlot.Provider>
          </Fg.Provider>
        </Animated.View>
      </View>
    </View>
  );
}

/** 개발용(웹): 뒤로 가기가 없는 화면(허브·알람·잠금 알림)에서 화면 목록으로 돌아가는 단추. 앱에는 없다. */
function DevList() {
  return (
    <Tap
      accessibilityLabel="화면 목록 (개발용)"
      onPress={() => (router.canGoBack() ? router.dismissTo('/') : router.replace('/'))}
      style={[abs({ left: 16, top: 6, width: 44, height: 44 }), { alignItems: 'center', justifyContent: 'center', opacity: 0.4 }]}
    >
      <Icon name="house" size={20} />
    </Tap>
  );
}

/** 절대 위치 (목업 좌표) */
export type Pos = { top?: number; left?: number; right?: number; bottom?: number; width?: number; height?: number };
export const abs = (p: Pos): ViewStyle => ({ position: 'absolute', ...p });

type TProps = Pos & {
  /** 글자 크기. 8단계: 120 84 56 40 32 24 20 16 */
  s?: 120 | 84 | 56 | 40 | 32 | 24 | 20 | 16;
  /** 굵게(800). 기본은 600 */
  k?: boolean;
  /** 색 */
  c?: string;
  /** 숫자·큰 글자: 800, 자간 -0.02em, 줄 높이 1 */
  num?: boolean;
  /** 제목: 40/800, 자간 -0.01em, 줄 높이 1.15 */
  h?: boolean;
  /** 가운데 정렬(좌우 0) */
  center?: boolean;
  /** 줄 높이 배수 */
  lh?: number;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  label?: string;
};
export function T({ s, k, c, num, h, center, lh, style, children, label, ...pos }: TProps) {
  const fg = useFg();
  const size = s ?? (h ? 40 : 24);
  const tight = num || h;
  const positioned = center || Object.keys(pos).length > 0;
  // 목업의 줄 높이(숫자 1 · 제목 1.15)는 글자 모양보다 낮아서, 기기·웹뷰가 줄 상자에 맞춰 자르면 숫자 위아래가 잘린다.
  // 그래서 실제 줄 상자는 글자가 다 들어가는 높이(1.35 이상)로 키우고, 늘어난 만큼 위아래로 반씩 당겨 목업 자리를 그대로 지킨다.
  const box = Math.round(size * (lh ?? (num ? 1 : h ? 1.15 : 1.25)));
  const line = Math.max(box, Math.ceil(size * 1.35));
  const pull = (line - box) / 2;
  const shift: TextStyle =
    pull === 0
      ? {}
      : pos.top != null
        ? { top: pos.top - pull }
        : pos.bottom != null
          ? { bottom: pos.bottom - pull }
          : { marginVertical: -pull };
  return (
    <Text
      accessibilityLabel={label}
      allowFontScaling={false}
      style={[
        {
          fontSize: size,
          fontWeight: k || tight ? '800' : '600',
          color: c ?? fg,
          lineHeight: line,
          textAlignVertical: 'center',
          letterSpacing: num ? -0.02 * size : h ? -0.01 * size : 0,
          includeFontPadding: false,
          fontVariant: ['tabular-nums'],
        },
        positioned && { position: 'absolute', ...pos },
        center && { left: 0, right: 0, textAlign: 'center' },
        shift,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** 선 아이콘. 어느 크기에서도 보이는 선이 3px 이 되게 굵기를 맞춘다. */
export function Icon({ name, size = 32, c, style }: { name: IconName; size?: number; c?: string; style?: StyleProp<ViewStyle> }) {
  const fg = useFg();
  const xml = useMemo(() => {
    const i = ICONS[name];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${i.vb}" ${i.attrs} stroke-width="${72 / size}">${i.body}</svg>`;
  }, [name, size]);
  return <SvgXml xml={xml} width={size} height={size} color={c ?? fg} style={style} />;
}

/** 삽화. 6판에서 Blender 로 다듬은 그림(알약·약포·인증 사진)은 PNG, 나머지(상태 모양·빈 알약 자리 등)는 SVG */
export function Ill({ name, w = 56, h, style }: { name: IllName; w?: number; h?: number; style?: StyleProp<ViewStyle> }) {
  const png = SYMBOL_PNG[name];
  if (png) return <Image source={PNG[png[0]]} resizeMode="contain" style={[{ width: w, height: h ?? w }, style as StyleProp<object>]} />;
  return <SvgXml xml={ILLUST[name]} width={w} height={h ?? w} style={style} />;
}

/** 회차 상태 기호 (모양+색): 완료 · 지금 · 예정 · 미복용 · 오복용 */
export type Status = 'done' | 'now' | 'planned' | 'missed' | 'wrong';
export function StatusMark({ s, size = 48, style }: { s: Status; size?: number; style?: StyleProp<ViewStyle> }) {
  return <Ill name={`status-${s}`} w={size} style={style} />;
}

const APressable = Animated.createAnimatedComponent(Pressable);
/**
 * 누를 수 있는 곳. 누르는 동안 옅어지고(투명도만), 떼면 돌아온다.
 * 크기를 줄이는 눌림(scale)은 웹에서 그 층을 비트맵으로 늘려 글자·그림이 흐려져서 쓰지 않는다.
 */
export function Tap({
  style,
  children,
  card,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children?: ReactNode; /** 안에 다른 버튼이 든 큰 면 */ card?: boolean }) {
  const [v] = useState(() => new Animated.Value(0));
  const to = (n: number) => Animated.timing(v, { toValue: n, duration: n ? 80 : 200, easing: Easing.out(Easing.quad), useNativeDriver: native }).start();
  return (
    <APressable
      accessibilityRole={card ? undefined : 'button'}
      {...rest}
      onPressIn={(e) => {
        to(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(0);
        onPressOut?.(e);
      }}
      style={[style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, card ? 0.85 : 0.7] }) }]}
    >
      {children}
    </APressable>
  );
}

/** 뒤늦게 톡 튀어나오는 것(원인 배지·멈춤 손): 그림을 먼저 보고 원인을 본다. */
export function Pop({ delay = 160, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 6, tension: 140, useNativeDriver: native })]).start();
  }, [v, delay]);
  return <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 1 : 0.6, 1] }) }] }]}>{children}</Animated.View>;
}

/**
 * 그림의 움직임. 화면이 하는 말을 그림이 몸짓으로 한 번 더 한다.
 * in = 조용히 나타남 · ok = 통 하고 자리잡음(맞아요) · no = 좌우로 도리도리(아니에요) · wobble = 한 번 흔들림(흔들린 사진)
 * ring = 울리는 중(되풀이) · float = 기다리는 중(천천히 떠 있음) · beat = 여기를 보세요(맥박) · breathe = 놓을 자리(옅어졌다 진해짐)
 * '동작 줄이기'가 켜져 있으면 흐려짐만 남긴다.
 */
export type MoveKind = 'in' | 'ok' | 'no' | 'wobble' | 'ring' | 'float' | 'beat' | 'breathe';
const SWING = [0, 0.2, 0.4, 0.6, 0.8, 1];
const swing = (v: Animated.Value, amp: number, unit?: 'deg') => {
  const out = [0, -amp, amp, -amp * 0.6, amp * 0.6, 0];
  return unit ? v.interpolate({ inputRange: SWING, outputRange: out.map((n) => `${n}${unit}`) }) : v.interpolate({ inputRange: SWING, outputRange: out });
};
export function Move({
  kind = 'in',
  delay = 60,
  x = 0,
  loud,
  style,
  children,
}: {
  kind?: MoveKind;
  delay?: number;
  /** 들어올 때 옆에서 오는 거리 */
  x?: number;
  /** ring 을 더 크게·자주 */
  loud?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [a] = useState(() => new Animated.Value(0));
  const [b] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const t = (toValue: number, duration: number, easing = Easing.linear) => Animated.timing(b, { toValue, duration, easing, useNativeDriver: native });
    const soft = Easing.inOut(Easing.sin);
    const enter =
      kind === 'ok' && !reduce
        ? Animated.spring(a, { toValue: 1, friction: 5, tension: 120, useNativeDriver: native })
        : Animated.timing(a, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: native });
    const after = reduce
      ? null
      : kind === 'no'
        ? t(1, 420)
        : kind === 'wobble'
          ? t(1, 640)
          : kind === 'ring'
            ? Animated.loop(Animated.sequence([t(1, 640), Animated.delay(loud ? 500 : 1400)]))
            : kind === 'float'
              ? Animated.loop(Animated.sequence([t(1, 1600, soft), t(0, 1600, soft)]))
              : kind === 'beat'
                ? Animated.loop(Animated.sequence([t(1, 300, soft), t(0, 300, soft), Animated.delay(900)]))
                : kind === 'breathe'
                  ? Animated.loop(Animated.sequence([t(1, 900, soft), t(0, 900, soft)]))
                  : null;
    const all = Animated.sequence([Animated.delay(delay), enter, ...(after ? [after] : [])]);
    all.start();
    return () => all.stop();
  }, [a, b, kind, delay, loud]);
  const fade = a.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: kind === 'breathe' ? Animated.multiply(fade, b.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] })) : fade,
          transform: [
            { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 0 : x, 0] }) },
            { scale: a.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 1 : kind === 'ok' ? 0.6 : 0.94, 1] }) },
            { translateX: kind === 'no' ? swing(b, 10) : 0 },
            { translateY: kind === 'float' ? b.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) : 0 },
            { rotate: kind === 'ring' ? swing(b, loud ? 9 : 5, 'deg') : kind === 'wobble' ? swing(b, 7, 'deg') : '0deg' },
            { scale: kind === 'beat' ? b.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) : 1 },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** 아래에서 16 올라오며 나타남(목업 mv-up). delay 는 초 */
export function Up({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    const a = Animated.timing(v, { toValue: 1, duration: 360, delay: delay * 1000, easing: Easing.bezier(0.05, 0.7, 0.1, 1), useNativeDriver: native });
    a.start();
    return () => a.stop();
  }, [v, delay]);
  // 기본은 화면 전체를 덮는 빈 판: 안의 절대 좌표가 화면 좌표 그대로다
  return (
    <Animated.View pointerEvents="box-none" style={[style ?? { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** 가로 한 줄 (가운데, 간격 8) */
export function Row({ gap = 8, center, style, children, ...pos }: Pos & { gap?: number; center?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const positioned = center || Object.keys(pos).length > 0;
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap },
        positioned && { position: 'absolute', ...pos },
        center && { left: 0, right: 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
}
