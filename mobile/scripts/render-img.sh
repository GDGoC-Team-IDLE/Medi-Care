#!/bin/zsh
# 앱에서 쓰는 Blender 그림을 고해상도로 다시 렌더한다 (design/ 은 읽기만 한다).
# 목업 img 는 표시 크기의 2배로 줄여 둔 것이라, 폰(3배 화면 × 화면 맞춤 배율)에서 흐리다.
# design/tools/blender/svg3d.py 를 임시로 복사해 출력 폴더와 렌더 배율(viewBox 1단위당 px)만 바꿔 돌린다.
# 배율 = 앱에서 가장 크게 그리는 폭의 4배 ÷ viewBox 폭. 모양·선 굵기(표시 px 기준)는 목업과 같다.
# 사용: npm run img:render   (결과: .img-hires/ → 이어서 npm run img -- --hires .img-hires)
set -e
cd "${0:A:h}/.."
DESIGN=${DESIGN:-../../design}
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
OUT=$PWD/.img-hires
TMP=$(mktemp -d)
mkdir -p $OUT
cp $DESIGN/tools/blender/svg3d.py $TMP/
python3 - $TMP/svg3d.py ${DESIGN:A}/assets/illust $OUT <<'PY'
import sys
p, src, out = sys.argv[1:]
s = open(p).read()
s = s.replace("SRC = HERE.parent.parent / 'assets' / 'illust'", f"SRC = pathlib.Path({src!r})")
s = s.replace("OUT = HERE.parent.parent / 'assets' / 'blender'", f"OUT = pathlib.Path({out!r})")
s = s.replace("JOBS = [a for a in ARGS if not a.startswith('--')]",
  "JOBS = [a.split('=')[0] for a in ARGS if not a.startswith('--')]\nK = {a.split('=')[0].replace(':', '@'): float(a.split('=')[1]) for a in ARGS if '=' in a}")
old = "    k = 4 if vb[2] <= 160 else 3\n"
assert old in s and 'K = {' in s, 'svg3d.py 가 바뀌어 패치가 맞지 않음'
s = s.replace(old, "    k = K.get(name + '@' + str(int(disp)), 4 if vb[2] <= 160 else 3)\n")
open(p, 'w').write(s)
PY
# 이름:목업표시px=배율   (앱 최대 표시 폭: 알약 64 · 약봉투 기호 180 · 사진 390 · 큰 그림 240~334)
JOBS=(
  "pill-capsule:56=4 pill-round-blue:56=4 pill-scored:56=4 pill-oval:56=4"
  "pouch-morning:56=4.5 pouch-evening:56=4.5 pouch-noon:56=4.5 pouch-noon:64=4 pouch-noon:150=4.5"
  "pouch-noon:240=6 pouch-open:240=6 envelope:132=4 envelope:240=6"
  "phone-ring:240=6 phone-shoot:240=6"
  "photo-envelope:200=4.6 photo-palm-morning:200=4.6 photo-palm-noon-1:200=4.6 photo-palm-noon-2:200=4.6"
  "verdict-ok:240=4 verdict-wrong-time:334=4.2 verdict-already:307=3.8 verdict-count:270=3.5 verdict-retake:262=4.4"
)
for line in $JOBS; do
  $BL -b -P $TMP/svg3d.py -- ${=line} 2>&1 | grep -E "^RENDERED|Traceback|Error:" | grep -v "strokes set" || true
done
# 무손실 압축만 한다 (색 수 줄이기는 부드러운 그림자에 띠가 생겨 쓰지 않는다)
python3 - $OUT <<'PY'
import sys, pathlib
from PIL import Image
for f in pathlib.Path(sys.argv[1]).glob('*.png'):
    Image.open(f).save(f, optimize=True)
PY
rm -rf $TMP
