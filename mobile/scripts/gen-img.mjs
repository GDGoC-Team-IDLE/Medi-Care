// 목업 6판의 Blender 그림(PNG)을 앱으로 옮긴다.
// - design/mockup/v6/img 의 PNG 중 목업이 쓰는 것을 assets/img 로 복사한다.
// - 목업 화면에 직접 넣은 조각 그림(<svg class="ill ..."> 안의 <image>·<g class>)을 나무 구조로 뽑아
//   src/constants/img.gen.ts 에 적는다. 조각 이름(vk0·ak-body 등)은 목업 CSS 의 부분 움직임 이름 그대로다.
// 사용: npm run img [-- <design/mockup/v6 경로>]   기본 경로: ../../design/mockup/v6
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v6 = path.resolve(root, process.argv[2] ?? '../../design/mockup/v6');
const html = fs.readFileSync(path.join(v6, 'src.html'), 'utf8');

// 기호로 쓰는 통짜 그림(design/tools/blender_layers.py 의 SYMBOL): 이름 → 파일 · viewBox
const SYMBOL = {
  'pill-capsule': ['pill-capsule@56.png', '0 0 64 64'],
  'pill-round-blue': ['pill-round-blue@56.png', '0 0 64 64'],
  'pill-scored': ['pill-scored@56.png', '0 0 64 64'],
  'pill-oval': ['pill-oval@56.png', '0 0 64 64'],
  'pouch-morning': ['pouch-morning@56.png', '0 0 160 160'],
  'pouch-noon': ['pouch-noon@56.png', '0 0 160 160'],
  'pouch-evening': ['pouch-evening@56.png', '0 0 160 160'],
  'photo-envelope': ['photo-envelope@200.png', '0 0 300 400'],
  'photo-palm-morning': ['photo-palm-morning@200.png', '0 0 300 400'],
  'photo-palm-noon-1': ['photo-palm-noon-1@200.png', '0 0 300 400'],
  'photo-palm-noon-2': ['photo-palm-noon-2@200.png', '0 0 300 400'],
};

const attrs = (s) => Object.fromEntries([...s.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** <svg ...> 안을 나무로: g(class) · img · vec(그대로 그릴 벡터 마크업) */
function tree(inner) {
  const rootNode = { cls: '', kids: [] };
  const stack = [rootNode];
  const re = /<(\/?)(g|image|path|circle|ellipse|rect)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(inner))) {
    const [, close, tag, a, self] = m;
    const top = stack[stack.length - 1];
    if (tag === 'g') {
      if (close) stack.pop();
      else {
        const n = { cls: attrs(a).class ?? '', kids: [] };
        top.kids.push(n);
        if (!self) stack.push(n);
      }
    } else if (tag === 'image') {
      const t = attrs(a);
      top.kids.push({ img: t.href.replace(/^img\//, ''), x: +t.x, y: +t.y, w: +t.width, h: +t.height });
    } else if (!close) {
      top.kids.push({ vec: `<${tag}${a.replace(/\s*xmlns:ns0="[^"]*"/, '')}/>` });
    }
  }
  return rootNode.kids;
}

const figs = {};
const used = new Set(Object.values(SYMBOL).map((v) => v[0]));
for (const m of html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)) {
  if (!m[2].includes('href="img/')) continue;
  const a = attrs(m[1]);
  const first = m[2].match(/href="img\/([^"@]+@\d+)/)[1];
  const kids = tree(m[2]);
  for (const f of m[2].matchAll(/href="img\/([^"]+)"/g)) used.add(f[1]);
  const key = first;
  if (!figs[key]) figs[key] = { vb: a.viewBox.split(/\s+/).map(Number), kids };
}

const out = path.join(root, 'assets', 'img');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = [...used].sort();
for (const f of files) fs.copyFileSync(path.join(v6, 'img', f), path.join(out, f));

const ts = `// npm run img 이 만든 파일입니다. 고치지 마세요. 원본: design/mockup/v6 (src.html · img/)
export const PNG = {
${files.map((f) => `  ${JSON.stringify(f)}: require('../../assets/img/${f}'),`).join('\n')}
} as const;
export type PngFile = keyof typeof PNG;

/** 통짜 그림: 이름 → [파일, viewBox] */
export const SYMBOL_PNG: Record<string, [PngFile, string]> = ${JSON.stringify(SYMBOL, null, 2)};

export type FigNode = { cls: string; kids: FigNode[] } | { img: PngFile; x: number; y: number; w: number; h: number } | { vec: string };
/** 조각 그림: 첫 조각 파일 이름(예: verdict-ok@240) → viewBox · 조각 나무 */
export const FIGS = ${JSON.stringify(figs, null, 2)} as unknown as Record<string, { vb: [number, number, number, number]; kids: FigNode[] }>;
`;
fs.writeFileSync(path.join(root, 'src', 'constants', 'img.gen.ts'), ts);
console.log(`png ${files.length}, figs ${Object.keys(figs).length}: ${Object.keys(figs).join(' ')}`);
