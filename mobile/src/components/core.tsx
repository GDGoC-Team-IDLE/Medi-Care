// 바탕 부품: 화면 틀(Phone), 글(T), 아이콘(Icon), 삽화(Ill), 누름(Tap)
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
      <Animated.View
        style={{
          width: W,
          height: H,
          opacity: enter,
          transform: [{ scale: s }, { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [reduce ? 0 : 12, 0] }) }],
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
  /** 숫자·큰 글자: 800, 자간 -0.03em, 줄 높이 1 */
  num?: boolean;
  /** 제목: 40/800, 자간 -0.03em, 줄 높이 1.15 */
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
  return (
    <Text
      accessibilityLabel={label}
      allowFontScaling={false}
      style={[
        {
          fontSize: size,
          fontWeight: k || tight ? '800' : '600',
          color: c ?? fg,
          lineHeight: Math.round(size * (lh ?? (num ? 1 : h ? 1.15 : 1.25))),
          letterSpacing: tight ? -0.03 * size : 0,
          includeFontPadding: false,
          fontVariant: ['tabular-nums'],
        },
        positioned && { position: 'absolute', ...pos },
        center && { left: 0, right: 0, textAlign: 'center' },
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

/** 삽화 */
export function Ill({ name, w = 56, h, style }: { name: IllName; w?: number; h?: number; style?: StyleProp<ViewStyle> }) {
  return <SvgXml xml={ILLUST[name]} width={w} height={h ?? w} style={style} />;
}

/** 회차 상태 기호 (모양+색): 완료 · 지금 · 예정 · 미복용 · 오복용 */
export type Status = 'done' | 'now' | 'planned' | 'missed' | 'wrong';
export function StatusMark({ s, size = 48, style }: { s: Status; size?: number; style?: StyleProp<ViewStyle> }) {
  return <Ill name={`status-${s}`} w={size} style={style} />;
}

const APressable = Animated.createAnimatedComponent(Pressable);
/** 누를 수 있는 곳. 누르면 살짝 들어가며 흐려지고, 떼면 돌아온다. */
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
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, card ? 0.985 : 0.97] }) }],
        },
      ]}
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
