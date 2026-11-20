// 화면 유형마다 되풀이되는 부품 (목업의 0번 틀 · 허브 · 판정 · 카메라 · 잠금 알림)
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import * as Speech from 'expo-speech';
import { back } from '@/lib/nav';
import { TODAY_LONG } from '@/lib/mock';
import { C, W } from '@/constants/theme';
import { Color, Icon, Ill, Pop, Row, StatusMark, T, Tap, abs, reduceMotion, useBackSlot, useFg, type IconName, type IllName, type Pos, type Status } from './core';

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

/** 듣기: 화면 내용을 소리로 읽어 준다 */
export function Say({ text, icon }: { text: string; icon?: boolean }) {
  useEffect(() => () => void Speech.stop(), []);
  const speak = () => {
    Speech.stop();
    Speech.speak(text, { language: 'ko-KR', rate: 0.9 });
  };
  return (
    <Tap
      accessibilityLabel="듣기"
      onPress={speak}
      style={[
        // 글자·아이콘의 오른쪽 끝이 끝선 28 에 오게
        abs({ right: icon ? 12 : 16, top: 58, height: 60 }),
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
        icon ? { width: 60 } : { paddingHorizontal: 12 },
      ]}
    >
      <Icon name="volume-2" />
      {!icon && <T k>듣기</T>}
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
  /** w = 흰 면(초록 바탕 위), idle = 옅은 면 + › , al = 알람(높이 112) */
  kind?: 'ink' | 'w' | 'idle' | 'al';
};
export function Btn({ label, icon, onPress, two, top, kind = 'ink' }: BtnProps) {
  const al = kind === 'al';
  const h = al ? 112 : 96;
  const bg = kind === 'w' ? C.white : kind === 'idle' ? C.tint : C.ink;
  const fg = kind === 'w' || kind === 'idle' ? C.ink : C.paper;
  return (
    <Tap
      onPress={onPress}
      style={[
        abs({ left: 28, right: 28, top: top ?? (al ? 560 : two ? 620 : 696), height: h }),
        { borderRadius: h / 2, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
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
}

export function Sub({ label, icon, onPress }: { label: string; icon?: IconName; onPress?: () => void }) {
  return (
    <Tap
      onPress={onPress}
      style={[abs({ left: 28, right: 28, top: 740, height: 60 }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
    >
      {icon && <Icon name={icon} size={24} />}
      <T k>{label}</T>
    </Tap>
  );
}

/** 원인 배지: 검은 원 56 안의 흰 아이콘 */
export function Badge({ icon, left = 306, top = 132 }: { icon: IconName; left?: number; top?: number }) {
  return (
    <Pop style={[abs({ left, top, width: 56, height: 56 }), { borderRadius: 28, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
      <Icon name={icon} c={C.white} />
    </Pop>
  );
}

/** 멈춤 손: 보호자에게 알린 오복용은 빨강, 알림이 없는 안내는 검정 */
export function Stop({ ink }: { ink?: boolean }) {
  if (ink)
    return (
      <Pop style={abs({ left: 306, top: 132 })}>
        <Icon name="hand" size={56} c={C.ink} />
      </Pop>
    );
  // 오복용: 빨간 면 원 88 + 흰 손. 실패 배지(검정 56)와 색·크기로 갈린다
  return (
    <Pop style={[abs({ left: 274, top: 116, width: 88, height: 88 }), { borderRadius: 44, backgroundColor: C.wrong, alignItems: 'center', justifyContent: 'center' }]}>
      <Icon name="hand" size={48} c={C.white} />
    </Pop>
  );
}

/* ── 판정 틀: 그림 132–372 · 제목 420 · 지시 474 · 한 줄 508 ── */
export function Fig({ name, ...pos }: { name: IllName } & Pos) {
  const p = { left: 28, top: 132, width: 334, height: 240, ...pos };
  return <Ill name={name} w={p.width} h={p.height} style={abs({ left: p.left, top: p.top })} />;
}
export function Verdict({ title, tell, line, lineIcon }: { title: string; tell?: string; line?: string; lineIcon?: IconName }) {
  const fg = useFg();
  const sub = fg === C.ink ? C.ink2 : fg;
  return (
    <>
      <T h center top={420}>
        {title}
      </T>
      {tell && (
        <T k center top={474}>
          {tell}
        </T>
      )}
      {line && (
        <Row center top={508}>
          {lineIcon && <Icon name={lineIcon} size={24} c={sub} />}
          <T c={sub}>{line}</T>
        </Row>
      )}
    </>
  );
}

/* ── 하루의 호: 실선 = 지나온 시간, 점선 = 남은 시간, 마디 = 회차(아침·점심·저녁) ── */
export type Slot = 'done' | 'plan' | 'missed' | 'wrong' | 'none';
const SLOT_T = [0.176, 0.441, 0.8235];
const SLOT_ICON: IconName[] = ['sunrise', 'sun', 'moon'];
type ArcProps = {
  /** 회차 상태. 빈 배열이면 마디 없이 호만 */
  slots?: Slot[];
  /** 지금 시각의 위치 0–1 */
  now: number;
  /** 크게 보일 회차 */
  big?: number;
  /** 지금 볼 회차(아이콘이 검정) */
  focus?: number;
  /** 지금 할 회차(노랑 원) */
  cur?: number;
  /** 보호자 현황의 작은 호 */
  small?: boolean;
};
export function Arc({ slots = [], now, big, focus, cur, small }: ArcProps) {
  const cx = 195;
  const [cy, rx, ry, n, height] = small ? [292, 167, 120, 32, 300] : [448, 167, 215, 44, 508];
  const P = (t: number) => [cx - rx * Math.cos(Math.PI * t), cy - ry * Math.sin(Math.PI * t)] as const;
  const seg = (a: number, b: number) => {
    const p = P(a);
    const q = P(b);
    return `M${p[0]} ${p[1]}A${rx} ${ry} 0 0 1 ${q[0]} ${q[1]}`;
  };
  const sz = (i: number) => (big === i ? n * 1.2 : n);
  return (
    <View style={abs({ left: 0, top: 0, width: W, height })} pointerEvents="none">
      {cur != null && slots[cur] && slots[cur] !== 'none' && <Pulse x={P(SLOT_T[cur])[0]} y={P(SLOT_T[cur])[1]} size={sz(cur)} />}
      <Svg width={W} height={height} viewBox={`0 0 ${W} ${height}`}>
        <Path d={seg(0, 1)} fill="none" stroke={C.track} strokeWidth={3} strokeDasharray="1 10" strokeLinecap="round" />
        <Path d={seg(0, now)} fill="none" stroke={C.ink} strokeWidth={6} strokeLinecap="round" />
        <Path d={`M${cx - rx} ${cy}H${cx + rx}`} stroke={C.ink} strokeWidth={3} strokeLinecap="round" />
        {slots.map((k, i) => {
          if (k === 'none' || cur !== i) return null;
          const p = P(SLOT_T[i]);
          return <Circle key={i} cx={p[0]} cy={p[1]} r={sz(i) / 2 - 2} fill={C.sun} stroke={C.ink} strokeWidth={3.5} />;
        })}
      </Svg>
      {slots.map((k, i) => {
        if (k === 'none' || cur === i) return null;
        const p = P(SLOT_T[i]);
        const z = sz(i);
        return <StatusMark key={i} s={k === 'plan' ? 'planned' : (k as Status)} size={z} style={abs({ left: p[0] - z / 2, top: p[1] - z / 2 })} />;
      })}
      {slots.length > 0 &&
        SLOT_ICON.map((name, i) => {
          const p = P(SLOT_T[i]);
          return <Icon key={name} name={name} c={focus === i ? C.ink : C.plan} style={abs({ left: p[0] - 16, top: p[1] - sz(i) / 2 - 40 })} />;
        })}
    </View>
  );
}

/** 지금 할 회차의 노랑 원 뒤에서 천천히 퍼지는 고리: '지금'이라는 신호 */
function Pulse({ x, y, size }: { x: number; y: number; size: number }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }));
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Animated.View
      style={[
        abs({ left: x - size / 2, top: y - size / 2, width: size, height: size }),
        { borderRadius: size / 2, backgroundColor: C.sun, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }] },
      ]}
    />
  );
}

/** 허브 아래 알약 줄: 알약 그림 · 개수 · 식전/식후 */
export function Pills({ pills, count, meal }: { pills: IllName[]; count: string; meal: string }) {
  return (
    <Row center top={504} style={{ height: 72 }}>
      {pills.map((p, i) => (
        <Ill key={i} name={p} />
      ))}
      <T s={32} k>
        {count}
      </T>
      <T c={C.ink2} style={{ marginLeft: 16 }}>
        {meal}
      </T>
    </Row>
  );
}

/* ── 카메라 ── */
/** 보는 창. 실제 카메라가 붙기 전까지는 예시 사진을 보여 준다. */
/** guide = 놓을 자리 윤곽(위 약포, 아래 손바닥) */
export function Viewfinder({ photo, dark, guide }: { photo: IllName; dark?: boolean; guide?: boolean }) {
  return (
    <View style={abs({ left: 36, top: 224, width: 318, height: 416 })}>
      <Ill name={photo} w={300} h={416} style={abs({ left: 9, top: 0 })} />
      {dark && <View style={[abs({ left: 9, top: 8, width: 300, height: 400 }), { borderRadius: 24, backgroundColor: '#000', opacity: 0.72 }]} />}
      <Svg width={318} height={416} viewBox="0 0 318 416" style={abs({ left: 0, top: 0 })}>
        {guide && (
          <>
            <Rect x={17} y={40} width={156} height={112} rx={20} fill="none" stroke="#fff" strokeWidth={3} strokeDasharray="1 10" strokeLinecap="round" />
            <Ellipse cx={177} cy={258} rx={74} ry={100} fill="none" stroke="#fff" strokeWidth={3} strokeDasharray="1 10" strokeLinecap="round" />
          </>
        )}
        <Path d="M4 44V4h40M274 4h40v40M314 372v40h-40M44 412H4v-40" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
export function Shutter({ onPress }: { onPress?: () => void }) {
  return (
    <Tap
      accessibilityLabel="찍기"
      onPress={onPress}
      style={[abs({ left: 139, top: 680, width: 112, height: 112 }), { borderRadius: 56, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' }]}
    >
      <View style={{ width: 104, height: 104, borderRadius: 52, borderWidth: 6, borderColor: C.cam, alignItems: 'center', justifyContent: 'center' }}>
        <T k c={C.cam}>
          찍기
        </T>
      </View>
    </Tap>
  );
}

/** 읽는 중·보는 중: 찍은 사진 둘레를 도는 고리 */
export function Ring({ photo, title }: { photo: IllName; title: string }) {
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [spin]);
  return (
    <>
      <View style={abs({ left: 115, top: 300, width: 160, height: 160 })}>
        <View style={[abs({ left: 16, top: 16, width: 128, height: 128 }), { borderRadius: 64, overflow: 'hidden' }]}>
          <Ill name={photo} w={160} h={214} style={abs({ left: -16, top: -36 })} />
        </View>
        <Svg width={160} height={160} viewBox="0 0 160 160" style={abs({ left: 0, top: 0 })}>
          <Circle cx={80} cy={80} r={76} fill="none" stroke={C.line} strokeWidth={6} />
        </Svg>
        <Animated.View style={[abs({ left: 0, top: 0, width: 160, height: 160 }), { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
          <Svg width={160} height={160} viewBox="0 0 160 160">
            <Path d="M80 4a76 76 0 0 1 76 76" fill="none" stroke={C.ink} strokeWidth={6} strokeLinecap="round" />
          </Svg>
        </Animated.View>
      </View>
      <T s={32} k center top={484}>
        {title}
      </T>
      <T c={C.ink2} center top={524}>
        조금만요
      </T>
    </>
  );
}

/* ── 잠금 화면 알림 ── */
export function Lock({ time, children }: { time: string; children: ReactNode }) {
  return (
    <>
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

type NotiProps = {
  /** 머리줄의 때: 지금 · 다시 */
  when?: string;
  status?: Status;
  title: string;
  body?: string;
  onPress?: () => void;
  actions?: { label: string; onPress?: () => void }[];
};
/** 보호자에게 가는 알림 한 장 */
export function Noti({ when = '지금', status, title, body, onPress, actions }: NotiProps) {
  return (
    <Tap card onPress={onPress} style={[abs({ left: 8, right: 8, top: 300 }), { borderRadius: 28, backgroundColor: C.white, padding: 20, gap: 8 }]}>
      <Color c={C.ink}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="pill" size={24} c={C.ink2} />
          <T s={16} c={C.ink2} style={{ flex: 1 }}>
            약 알림 · {when}
          </T>
          {status && <StatusMark s={status} size={24} />}
        </View>
        <T s={20} k>
          {title}
        </T>
        {body && (
          <T s={16} c={C.ink2}>
            {body}
          </T>
        )}
        {actions && (
          // 첫 버튼의 글자가 제목 시작선에 오게 안쪽 여백만큼 당긴다
          <View style={{ flexDirection: 'row', gap: 8, marginLeft: -16 }}>
            {actions.map((a) => (
              <Tap key={a.label} onPress={a.onPress} style={{ height: 48, paddingHorizontal: 16, justifyContent: 'center' }}>
                <T s={16} k>
                  {a.label}
                </T>
              </Tap>
            ))}
          </View>
        )}
      </Color>
    </Tap>
  );
}

/** 복용자에게 가는 약 알림 (크게) */
export function PillNoti({ when, title, body, onPress }: { when: string; title: string; body?: string; onPress?: () => void }) {
  return (
    <Tap card onPress={onPress} style={[abs({ left: 8, right: 8, top: 300 }), { borderRadius: 28, backgroundColor: C.white, padding: 20, gap: 8 }]}>
      <Color c={C.ink}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="pill" size={24} c={C.ink2} />
          <T s={16} c={C.ink2}>
            약 알림 · {when}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Ill name="pouch-noon" w={64} />
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
        <View style={{ flexDirection: 'row' }}>
          <Tap onPress={onPress} style={{ flex: 1, height: 80, borderRadius: 40, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <Icon name="camera" size={40} c={C.white} />
            <T s={32} k lh={1} c={C.white}>
              찍기
            </T>
          </Tap>
        </View>
      </Color>
    </Tap>
  );
}
