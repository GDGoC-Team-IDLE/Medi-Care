// 조각 그림: 목업 6판의 Blender PNG 조각을 쌓고, 목업 CSS 의 부분 움직임(.vk-* · .am-*)을 Animated 로 옮긴다.
// 조각 나무는 npm run img 가 src/constants/img.gen.ts 에 만든다(FIGS). 움직임 이름·시간은 design/mockup/v6/src.html 그대로.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { FIGS, PNG, type FigNode } from '@/constants/img.gen';
import { reduceMotion } from './core';

const native = Platform.OS !== 'web';

/* ── 키프레임 ── */
type KF = { at: number[]; tx?: number[]; ty?: number[]; rot?: number[]; sc?: number[]; sy?: number[]; op?: number[]; origin?: 'bottom' };
const K: Record<string, KF> = {
  drop: { at: [0, 0.6, 0.8, 1], op: [0, 1, 1, 1], ty: [-70, 6, -3, 0] },
  fill: { at: [0, 1], sy: [0, 1], origin: 'bottom' },
  nudge: { at: [0, 0.25, 0.5, 0.75, 1], tx: [0, -8, 0, -5, 0], ty: [0, -6, 0, -3, 0], rot: [0, -5, 0, -3, 0] },
  shake: { at: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1], tx: [0, -7, 7, -5, 5, -2, 0] },
  lift: { at: [0, 0.4, 1], tx: [-30, -30, 0], ty: [64, 64, 0], rot: [-12, -12, 0] },
  pop: { at: [0, 0.7, 1], op: [0, 1, 1], sc: [0.5, 1.08, 1] },
  pulse: { at: [0, 0.5, 1], op: [1, 0.2, 1] },
  blink: { at: [0, 0.5, 1], op: [1, 0, 1] },
  appear: { at: [0, 1], op: [0, 1] },
  turn: { at: [0, 1], rot: [-240, 0] },
  wig: { at: [0, 0.05, 0.11, 0.17, 0.23, 0.28, 0.32, 1], rot: [0, -6, 6, -4, 3, -1, 0, 0] },
  wigl: { at: [0, 0.09, 0.19, 0.29, 0.39, 0.5, 0.62, 1], rot: [0, -10, 10, -7, 6, -2, 0, 0] },
  hop: { at: [0, 0.12, 0.22, 0.3, 1], ty: [0, -7, 2, 0, 0] },
  tip: { at: [0, 0.18, 0.26, 0.34, 0.5, 0.58, 0.66, 0.84, 1], rot: [0, -16, -16, -16, -16, -16, -16, 0, 0], ty: [0, 0, 7, 0, 0, 7, 0, 0, 0] },
  float: { at: [0, 0.5, 1], ty: [0, -8, 0] },
  dim: { at: [0, 0.5, 1], op: [1, 0.1, 1] },
  ask: { at: [0, 0.25, 0.65, 1], rot: [0, -7, 6, 0] },
};
/** 움직임 하나: 키프레임 · 길이(s) · 시작(s) · 되풀이(Infinity = 계속) */
type Run = [kf: keyof typeof K, dur: number, delay: number, iter?: number];
const OUT = Easing.bezier(0.05, 0.7, 0.1, 1);

/** 그림 종류(목업의 svg class) → 조각 이름 → 움직임. 같은 조각에 여럿이면 차례로 */
const MOTION: Record<string, Record<string, Run>> = {
  'vk-ok': { water: ['fill', 0.7, 0.15], vk1: ['drop', 0.5, 0.35], vk2: ['drop', 0.5, 0.5] },
  'vk-wt': { vk3: ['appear', 0.6, 0.3], vk2: ['nudge', 0.8, 0.85] },
  'vk-al': { vk0: ['lift', 0.7, 0.1], vk1: ['shake', 0.5, 0.8] },
  'vk-ct': { vk0: ['pop', 0.4, 0.15], vk1: ['pulse', 0.8, 0.4, 3] },
  'vk-rt': { vk0: ['shake', 0.6, 0.2], vk1: ['blink', 0.2, 0.2, 3], vk2: ['turn', 0.7, 0.6] },
  'am-ring': { 'ak-body': ['wig', 2, 0.5, Infinity], 'ak-p1': ['hop', 2, 0.5, Infinity], 'ak-p2': ['hop', 2, 0.58, Infinity], 'ak-p3': ['hop', 2, 0.66, Infinity] },
  'am-ring loud': { 'ak-body': ['wigl', 1.1, 0.5, Infinity], 'ak-p1': ['hop', 1.1, 0.5, Infinity], 'ak-p2': ['hop', 1.1, 0.58, Infinity], 'ak-p3': ['hop', 1.1, 0.66, Infinity] },
  'am-float': { 'ak-body': ['float', 3.2, 0.4, Infinity] },
  'am-dim': { 'ak-txt': ['dim', 1.4, 0.4, 2] },
  'am-ask': { 'ak-body': ['ask', 1.1, 0.4] },
  'am-rest': { 'ak-p1': ['drop', 0.5, 0.3], 'ak-p2': ['drop', 0.5, 0.42], 'ak-p3': ['drop', 0.5, 0.54] },
  'am-wait': { 'ak-cn': ['pulse', 1.4, 0.5, Infinity] },
  'am-wave': { 'ak-body': ['wig', 2, 0.5, Infinity], 'ak-wave': ['pulse', 1, 0.5, Infinity] },
  'am-tip': { 'ak-body': ['tip', 1.5, 0.4] },
  still: {},
};
export type FigMotion = keyof typeof MOTION;

/** 한 움직임을 도는 값. 동작 줄이기면 끝 모습(=제자리)에서 멈춘다 */
function useRun(run?: Run) {
  const [v] = useState(() => new Animated.Value(run && !reduceMotion() ? 0 : 1));
  useEffect(() => {
    if (!run || reduceMotion()) return;
    const [kf, dur, delay, iter = 1] = run;
    const ease = kf === 'drop' || kf === 'lift' ? Easing.bezier(0.3, 0.8, 0.4, 1) : kf === 'fill' || kf === 'turn' ? OUT : kf === 'pop' ? Easing.bezier(0.3, 1.4, 0.5, 1) : kf === 'blink' ? Easing.linear : Easing.inOut(Easing.sin);
    const one = Animated.timing(v, { toValue: 1, duration: dur * 1000, easing: ease, useNativeDriver: native });
    const body = iter === 1 ? one : Animated.loop(one, { iterations: iter === Infinity ? -1 : iter, resetBeforeIteration: true });
    const a = Animated.sequence([Animated.delay(delay * 1000), body]);
    a.start();
    return () => a.stop();
  }, [v, run]);
  return v;
}

function styleOf(v: Animated.Value, kf: KF, s: number) {
  const ip = (out: number[], f = 1) => v.interpolate({ inputRange: kf.at, outputRange: out.map((n) => n * f) });
  const tr: Record<string, unknown>[] = [];
  if (kf.tx) tr.push({ translateX: ip(kf.tx, s) });
  if (kf.ty) tr.push({ translateY: ip(kf.ty, s) });
  if (kf.rot) tr.push({ rotate: v.interpolate({ inputRange: kf.at, outputRange: kf.rot.map((n) => `${n}deg`) }) });
  if (kf.sc) tr.push({ scale: ip(kf.sc) });
  if (kf.sy) tr.push({ scaleY: ip(kf.sy) });
  return [kf.op && { opacity: ip(kf.op) }, tr.length > 0 && { transform: tr }, kf.origin === 'bottom' && { transformOrigin: 'bottom' }] as unknown as StyleProp<ViewStyle>;
}

/* ── 조각 나무 ── */
type Box = { x: number; y: number; w: number; h: number };
function bbox(n: FigNode, vb: Box): Box | null {
  if ('img' in n) return { x: n.x, y: n.y, w: n.w, h: n.h };
  if ('vec' in n) return vb;
  const bs = n.kids.map((k) => bbox(k, vb)).filter(Boolean) as Box[];
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

type Ctx = { s: number; vb: Box; motion: Record<string, Run> };
function Group({ node, ctx, origin }: { node: Extract<FigNode, { kids: FigNode[] }>; ctx: Ctx; origin: { x: number; y: number } }) {
  const b = bbox(node, ctx.vb) ?? ctx.vb;
  const run = ctx.motion[node.cls];
  const v = useRun(run);
  const style = run ? styleOf(v, K[run[0]], ctx.s) : null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (b.x - origin.x) * ctx.s, top: (b.y - origin.y) * ctx.s, width: b.w * ctx.s, height: b.h * ctx.s }, style]}>
      {node.kids.map((k, i) => (
        <Node key={i} node={k} ctx={ctx} origin={{ x: b.x, y: b.y }} />
      ))}
    </Animated.View>
  );
}
function Node({ node, ctx, origin }: { node: FigNode; ctx: Ctx; origin: { x: number; y: number } }) {
  if ('kids' in node) return <Group node={node} ctx={ctx} origin={origin} />;
  if ('img' in node)
    return <Image source={PNG[node.img]} resizeMode="stretch" style={{ position: 'absolute', left: (node.x - origin.x) * ctx.s, top: (node.y - origin.y) * ctx.s, width: node.w * ctx.s, height: node.h * ctx.s }} />;
  // 그려지는 화살표·도는 점선 같은 벡터 조각: 그림 전체 좌표로 그린다
  const { vb, s } = ctx;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">${node.vec.replace(/ vector-effect="[^"]*"/, '').replace(/stroke-width="[\d.]+"/, `stroke-width="${(3 / s).toFixed(2)}"`)}</svg>`;
  return <SvgXml xml={xml} width={vb.w * s} height={vb.h * s} style={{ position: 'absolute', left: (vb.x - origin.x) * s, top: (vb.y - origin.y) * s }} />;
}

/**
 * 조각 그림. name = 첫 조각 파일 이름(예: 'verdict-ok@240'), motion = 목업의 그림 class(예: 'vk-ok', 'am-ring loud').
 * 상자(w×h) 안에 viewBox 를 가운데 맞춰 넣는다(목업 svg 기본 preserveAspectRatio).
 */
export function Fig3({ name, motion = 'still', w, h, style, children }: { name: keyof typeof FIGS | string; motion?: FigMotion; w: number; h: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const fig = FIGS[name];
  const ctx = useMemo<Ctx>(() => {
    const [x, y, vw, vh] = fig.vb;
    const s = Math.min(w / vw, h / vh);
    return { s, vb: { x, y, w: vw, h: vh }, motion: MOTION[motion] };
  }, [fig, w, h, motion]);
  const ox = (w - ctx.vb.w * ctx.s) / 2;
  const oy = (h - ctx.vb.h * ctx.s) / 2;
  return (
    <View pointerEvents="none" style={[{ width: w, height: h }, style]}>
      <View style={{ position: 'absolute', left: ox, top: oy, width: ctx.vb.w * ctx.s, height: ctx.vb.h * ctx.s }}>
        {fig.kids.map((k, i) => (
          <Node key={i} node={k} ctx={ctx} origin={{ x: ctx.vb.x, y: ctx.vb.y }} />
        ))}
      </View>
      {children}
    </View>
  );
}
