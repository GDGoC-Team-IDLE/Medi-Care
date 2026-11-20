// design/assets 의 SVG 를 src/constants/assets.gen.ts 로 옮긴다 (react-native-svg 의 SvgXml 로 그린다).
// 사용: npm run assets [-- <design/assets 경로>]   기본 경로: ../../design/assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(root, process.argv[2] ?? '../../design/assets');
// 목업 build.py 와 같은 색 치환 (크림 → 중성)
const SWAP = { '#8A8376': '#858585', '#8a8376': '#858585', '#F0E2C0': '#F4E0A0', '#D9D2C4': '#D4D4D4', '#FAF6EE': '#FAFAFA' };

function read(dir, file, prefix) {
  let t = fs.readFileSync(path.join(src, dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  const m = t.match(/^<svg([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!m) throw new Error('svg 가 아님: ' + file);
  const attrs = Object.fromEntries([...m[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
  let body = m[2].replace(/\s+/g, ' ').trim();
  // 웹에서는 id 가 문서 전체에서 겹치므로 에셋 이름을 앞에 붙인다
  body = body
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
  for (const [a, b] of Object.entries(SWAP)) body = body.split(a).join(b);
  return { attrs, body };
}
const names = (dir) => fs.readdirSync(path.join(src, dir)).filter((f) => f.endsWith('.svg')).sort();
const keep = (attrs, keys) => keys.filter((k) => attrs[k] != null).map((k) => `${k}="${attrs[k]}"`).join(' ');

const icons = {};
for (const f of names('icons')) {
  const name = f.replace(/\.svg$/, '').replace(/^custom-/, 'c-');
  const { attrs, body } = read('icons', f, 'i-' + name);
  // 선 굵기는 크기에 맞춰 Icon 이 넣는다 (보이는 선 3px)
  icons[name] = { vb: attrs.viewBox, attrs: keep(attrs, ['fill', 'stroke', 'stroke-linecap', 'stroke-linejoin']), body };
}
const illust = {};
for (const f of names('illust')) {
  const name = f.replace(/\.svg$/, '');
  const { attrs, body } = read('illust', f, 'a-' + name);
  const a = keep(attrs, ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
  illust[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${attrs.viewBox}" ${a}>${body}</svg>`;
}
const out = `// 자동 생성 파일 — 고치지 말 것. 다시 만들기: npm run assets
export const ICONS = ${JSON.stringify(icons, null, 1)} as const;
export const ILLUST = ${JSON.stringify(illust, null, 1)} as const;
export type IconName = keyof typeof ICONS;
export type IllName = keyof typeof ILLUST;
`;
fs.writeFileSync(path.join(root, 'src/constants/assets.gen.ts'), out);
console.log(`icons ${Object.keys(icons).length}, illust ${Object.keys(illust).length}`);
