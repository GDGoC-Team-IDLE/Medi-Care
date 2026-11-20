// 약봉투 등록 (찍기 → 읽기 → 회차 확인 → 주의 → 일정 시작) · 고치기 (회차 → 약 목록 → 약 하나 · 일수)
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { back, go, swap } from '@/lib/nav';
import { api, ApiError, appendFile } from '@/lib/api';
import { C, R } from '@/constants/theme';
import { Icon, Ill, Phone, Pop, Row, T, Tap, Up, abs, type IconName, type IllName } from '@/components/core';
import { Back, Btn, CamTitle, Say, ScanCard, Shutter, Sub, Tray, Viewfinder, lastShot, type ScanSpec } from '@/components/parts';

/** 행 끝의 ›: 보이는 선의 오른쪽 끝이 끝선 28 에 오게 당긴다 */
const CHEV = { marginRight: -12 };

/** p01 약봉투 찍기. 보호자가 대신 찍어도 된다 */
export function Scan() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close onPress={() => swap('p21-empty')} />
      <CamTitle icon="c-envelope-rx" title="약봉투" tell="글씨가 보이게 펴 주세요" />
      <Viewfinder photo="photo-envelope" />
      <Shutter onPress={() => go('p12-reading')} />
      {/* 7판: 찍는 화면에서만 듣기를 셔터 오른쪽(오른손 엄지 자리)으로 */}
      <Say cam text="약봉투를 글씨가 보이게 펴서 찍어 주세요." />
    </Phone>
  );
}

/** p12 글줄 위치(사진 좌표 300×400). 앱에서는 OCR 글줄 상자(0~1 비율) × 사진 크기로 바뀐다 */
const READ: ScanSpec = {
  photo: 'photo-envelope',
  glints: [
    ['<rect x="99" y="89" width="106" height="40" rx="20" transform="rotate(-2.3 152 109)"/>', 0.8],
    ['<rect x="72" y="139" width="158" height="17" rx="8.5" transform="rotate(-2.3 151 147)"/>', 0.93],
    ['<rect x="74" y="154" width="172" height="72" rx="14" transform="rotate(-2.3 160 190)"/>', 1.08],
    ['<rect x="78" y="236" width="164" height="17" rx="8.5" transform="rotate(-2.3 160 245)"/>', 1.28],
    ['<rect x="80" y="257" width="114" height="17" rx="8.5" transform="rotate(-2.3 137 265)"/>', 1.35],
    ['<rect x="122" y="297" width="116" height="17" rx="8.5" transform="rotate(-2.3 180 305)"/>', 1.49],
  ],
  frame: { d: 'M62 108V94A14 14 0 0 1 76 80h22M218 80h22a14 14 0 0 1 14 14v14M254 248v14a14 14 0 0 1-14 14h-22M98 276H76a14 14 0 0 1-14-14v-14', rotate: 'rotate(-2.3 158 178)', at: 1.55 },
  marks: [
    ['<path d="M84 232L120 230.5"/>', 4.45],
    ['<path d="M141 228L177 226.5"/>', 4.75],
    ['<path d="M199 224L235 222.5"/>', 5.05],
  ],
  slots: [
    ['pouch-morning', 1.6, 4.55],
    ['pouch-noon', 2.6, 4.85],
    ['pouch-evening', 3.6, 5.15],
  ],
};

type Slot = 'MORNING' | 'LUNCH' | 'DINNER' | 'BEDTIME';

/** POST /prescriptions/analyze 응답 (쓰는 칸만) */
interface Preview {
  drugs: { name: string; count_per_dose: number; slots: Slot[]; days: number }[];
  needs_retake: boolean;
}

/** 마지막 분석 결과. p12 가 받고 p23 이 보여 준다 (없으면 예시) */
let preview: Preview | null = null;

/** 장면(밑줄·칸 채우기)이 끝나는 시각. 응답이 빨리 와도 여기까지는 보여 준다 */
const SCENE_MS = 5900;
/** 이보다 오래 걸리면 p15t */
const SLOW_MS = 8000;

async function analyze(uri: string): Promise<Preview> {
  const form = new FormData();
  await appendFile(form, 'image', { uri, name: 'envelope.jpg', type: 'image/jpeg' });
  return api.postForm<Preview>('/prescriptions/analyze', form);
}

/** 분석 실패 → 화면. 다시 해 보기가 약봉투 찍기로 오도록 retry 를 붙인다 */
function failRoute(x: unknown): string {
  const status = x instanceof ApiError ? x.status : -1;
  if (status === 413 || status === 415) return 'p13-noread';
  if (status === 0) return 'p15-offline?retry=p01-scan';
  return 'p15t-slow?retry=p01-scan'; // 503 AI_UNAVAILABLE 등
}

/**
 * p12 읽는 중. 찍은 사진을 POST /prescriptions/analyze 로 보낸다.
 * 읽었으면 장면이 끝난 뒤 p23, 못 읽었으면 바로 p13, 8초가 넘으면 p15t.
 * 찍은 사진 없이 열면(화면 목록) 예전처럼 장면이 끝나면 예시 회차 확인으로 간다.
 */
export function Reading() {
  useEffect(() => {
    const uri = lastShot();
    if (!uri) {
      const t = setTimeout(() => swap('p23-review'), SCENE_MS);
      return () => clearTimeout(t);
    }
    let done = false;
    const to = (id: string) => {
      if (done) return;
      done = true;
      swap(id);
    };
    const started = Date.now();
    const slow = setTimeout(() => to('p15t-slow?retry=p01-scan'), SLOW_MS);
    analyze(uri).then(
      (p) => {
        if (done) return;
        if (p.needs_retake || !p.drugs.length) return to('p13-noread');
        preview = p;
        setTimeout(() => to('p23-review'), Math.max(0, SCENE_MS - (Date.now() - started)));
      },
      (x) => to(failRoute(x)),
    );
    return () => {
      done = true;
      clearTimeout(slow);
    };
  }, []);
  return (
    <Phone>
      <Back close />
      <ScanCard spec={READ} title="읽고 있어요" />
    </Phone>
  );
}

function SlotRow({ top, pouch, name, count, onPress, i = 0 }: { top: number; pouch: IllName; name: string; count: string; onPress: () => void; i?: number }) {
  return (
    <Tap onPress={onPress} style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <Pop delay={250 + i * 90}>
        <Ill name={pouch} />
      </Pop>
      <T s={32} k style={{ flex: 1 }}>
        {name}
      </T>
      <T s={56} num>
        {count}
      </T>
      <Icon name="chevron-right" style={CHEV} />
    </Tap>
  );
}

const SLOT_ROW: Record<Slot, { name: string; pouch: IllName }> = {
  MORNING: { name: '아침', pouch: 'pouch-morning' },
  LUNCH: { name: '점심', pouch: 'pouch-noon' },
  DINNER: { name: '저녁', pouch: 'pouch-evening' },
  BEDTIME: { name: '자기 전', pouch: 'pouch-blank' },
};
/** 읽어 줄 때 알 수는 고유어로 (두 알, 세 알) */
const SAY_COUNT = ['영', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** 분석 결과 → 복용 일수 · 회차별 알 수. 결과가 없으면 예시(7일, 아침 2 · 점심 2 · 저녁 3) */
function summary(p: Preview | null): { days: number; rows: [Slot, number][] } {
  if (!p) return { days: 7, rows: [['MORNING', 2], ['LUNCH', 2], ['DINNER', 3]] };
  const rows = (Object.keys(SLOT_ROW) as Slot[])
    .map((s): [Slot, number] => [s, p.drugs.filter((d) => d.slots.includes(s)).reduce((n, d) => n + d.count_per_dose, 0)])
    .filter(([, n]) => n > 0);
  return { days: Math.max(...p.drugs.map((d) => d.days)), rows };
}

/** p23 회차 요약. 행 → 그 회차의 약 목록, 제목 → 복용 일수 */
export function Review() {
  const { days, rows } = summary(preview);
  const four = rows.length > 3; // 자기 전까지 네 줄이면 버튼에 닿지 않게 좁힌다
  const said = rows.map(([s, n]) => `${SLOT_ROW[s].name} ${SAY_COUNT[n] ?? n} 알`).join(', ');
  return (
    <Phone>
      <Back />
      <Say text={`${days}일치 약이에요. ${said}. 맞으면 맞아요를 눌러 주세요.`} />
      <Tap onPress={() => go('p25d-days')} style={[abs({ left: 28, top: 121, height: 60 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <T h>{days}일치 약</T>
        <Icon name="chevron-right" />
      </Tap>
      {rows.map(([s, n], i) => (
        <SlotRow key={s} i={i} top={(four ? 204 : 228) + i * (four ? 100 : 120)} pouch={SLOT_ROW[s].pouch} name={SLOT_ROW[s].name} count={`${n}알`} onPress={() => go('p23b-slot')} />
      ))}
      <Btn two label="맞아요" onPress={() => go('p03-caution')} />
      <Sub label="잘 모르겠어요" onPress={() => go('p22-unsure')} />
    </Phone>
  );
}

function Caution({ top, icon, title, tell }: { top: number; icon: IconName; title: string; tell: string }) {
  return (
    <View style={[abs({ left: 28, right: 28, top }), { flexDirection: 'row', alignItems: 'flex-start', gap: 16 }]}>
      <Icon name={icon} c={C.ink2} />
      <View style={{ flex: 1 }}>
        <T k>{title}</T>
        <T c={C.ink2}>{tell}</T>
      </View>
    </View>
  );
}

const PRIMARY_CAUTION = {
  title: '같이 드시면 안 돼요',
  drugs: '리바로정 · 젬피브로질',
  tell: '다른 병원 약은 약사에게 물어보세요',
};

const OTHER_CAUTIONS = [
  { top: 388, icon: 'circle-alert', title: '어지러울 수 있어요', tell: '천천히 일어나세요' },
  { top: 484, icon: 'pill', title: '위장약이 겹쳐요', tell: '약사에게 물어보세요' },
] as const;

/** p03 주의사항. DUR 3종: 병용금기(맨 위, 크게) · 노인주의 · 효능군 중복. 약 조합은 예시 */
export function CautionScreen() {
  const { title, drugs, tell } = PRIMARY_CAUTION;
  const guidance = [title, drugs, tell, ...OTHER_CAUTIONS.flatMap((item) => [item.title, item.tell])];

  return (
    <Phone>
      <Back />
      <Say text={guidance.join('. ')} />
      <Row left={28} top={132}>
        {/* 문제의 두 약이 하나씩 놓인다 */}
        <Pop delay={120}>
          <Ill name="pill-scored" />
        </Pop>
        <Pop delay={240}>
          <Ill name="pill-oval" />
        </Pop>
      </Row>
      <T h left={28} top={204}>
        {title}
      </T>
      <T k left={28} top={258}>
        {drugs}
      </T>
      <T c={C.ink2} left={28} top={292}>
        {tell}
      </T>
      {OTHER_CAUTIONS.map((item) => <Caution key={item.icon} {...item} />)}
      <Btn label="알겠어요" onPress={() => go('p28-start')} />
    </Phone>
  );
}

/** p28 일정 시작. 등록 시각이 지난 회차(오늘 아침)는 만들지 않는다 */
export function Start() {
  return (
    <Phone>
      <Back />
      <Say icon text="오늘 점심부터 시작해요. 11월 26일까지 드세요." />
      <Tray slots={['none', 'plan', 'plan']} f={1} now={0.3} />
      <Up delay={0.6}>
        <T s={32} k c={C.plan} center top={336}>
          오늘
        </T>
      </Up>
      <Up delay={0.7}>
        <T s={56} k lh={1} center top={384}>
          점심부터
        </T>
      </Up>
      <Up delay={0.7}>
        <T c={C.ink2} center top={472}>
          11월 26일까지
        </T>
      </Up>
      <Btn up={0.85} label="시작하기" onPress={() => swap('p04-today')} />
    </Phone>
  );
}

function DrugRow({ top, pill, name, onPress, i = 0 }: { top: number; pill: IllName; name: string; onPress: () => void; i?: number }) {
  return (
    <Tap onPress={onPress} style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <Pop delay={250 + i * 90}>
        <Ill name={pill} />
      </Pop>
      <View style={{ flex: 1 }}>
        <T k>{name}</T>
        <T c={C.ink2}>식후</T>
      </View>
      <T s={32} k>
        1알
      </T>
      <Icon name="chevron-right" style={CHEV} />
    </Tap>
  );
}

/** p23b 그 회차에 든 약 목록 */
export function SlotDrugs() {
  return (
    <Phone>
      <Back />
      <Say text="점심 약은 두 알이에요. 다이아벡스정 한 알, 스티렌정 한 알." />
      <T h left={28} top={132}>
        점심 2알
      </T>
      <DrugRow top={228} pill="pill-capsule" name="다이아벡스정" onPress={() => go('p25-drug')} />
      <DrugRow i={1} top={348} pill="pill-round-blue" name="스티렌정" onPress={() => go('p25-drug')} />
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

/** 고르는 칸: 켜짐 = 글자 검정 + 아래 4px 막대 */
function Toggle({ on, icon, label, row, onPress }: { on: boolean; icon: IconName; label: string; row?: boolean; onPress: () => void }) {
  const c = on ? C.ink : C.plan;
  return (
    <Tap
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        flex: 1,
        flexDirection: row ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: row ? 8 : 4,
        borderBottomWidth: 4,
        borderBottomColor: on ? C.ink : C.line,
      }}
    >
      <Icon name={icon} c={c} />
      <T k c={c}>
        {label}
      </T>
    </Tap>
  );
}

function Stepper({ value, onChange, min = 1, max = 99, unit }: { value: number; onChange: (n: number) => void; min?: number; max?: number; unit: string }) {
  const round = { width: 96, height: 96, borderRadius: R.l, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={[abs({ left: 28, right: 28, top: 504, height: 96 }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      <Tap accessibilityLabel="빼기" onPress={() => onChange(Math.max(min, value - 1))} style={round}>
        <Icon name="minus" size={40} />
      </Tap>
      {/* 가운데 칸 = 334 − 버튼 96×2 = 142. 두 자리('10일')는 글자를 줄여 이 칸 한 줄에 맞춘다 */}
      <View style={{ width: 142, alignItems: 'center' }}>
        <T s={84} num fit={142}>
          {`${value}${unit}`}
        </T>
      </View>
      <Tap accessibilityLabel="더하기" onPress={() => onChange(Math.min(max, value + 1))} style={round}>
        <Icon name="plus" size={40} />
      </Tap>
    </View>
  );
}

/** p25 약 한 가지 고치기: 복용 시간대 · 식전/식후 · 1회 개수 */
export function Drug() {
  const [slots, setSlots] = useState([true, true, false]);
  const [after, setAfter] = useState(true);
  const [count, setCount] = useState(1);
  const flip = (i: number) => setSlots(slots.map((v, j) => (j === i ? !v : v)));
  return (
    <Phone>
      <Back />
      <Say text="스티렌정. 드시는 때와 개수를 고칠 수 있어요." />
      <T h left={28} top={132}>
        스티렌정
      </T>
      <View style={[abs({ left: 28, right: 28, top: 260, height: 96 }), { flexDirection: 'row', gap: 8 }]}>
        <Toggle on={slots[0]} icon="sunrise" label="아침" onPress={() => flip(0)} />
        <Toggle on={slots[1]} icon="sun" label="점심" onPress={() => flip(1)} />
        <Toggle on={slots[2]} icon="moon" label="저녁" onPress={() => flip(2)} />
      </View>
      <View style={[abs({ left: 28, right: 28, top: 380, height: 60 }), { flexDirection: 'row', gap: 8 }]}>
        <Toggle row on={!after} icon="c-meal-before" label="식전" onPress={() => setAfter(false)} />
        <Toggle row on={after} icon="c-meal-after" label="식후" onPress={() => setAfter(true)} />
      </View>
      <Stepper value={count} onChange={setCount} max={9} unit="알" />
      <Btn label="저장하기" onPress={back} />
    </Phone>
  );
}

/** p25d 복용 일수. 끝 날짜는 계산값(오늘 + 일수 − 1) */
export function Days() {
  const [days, setDays] = useState(7);
  const end = new Date(2026, 10, 20 + days - 1);
  return (
    <Phone>
      <Back />
      <Say text={`오늘부터 ${days}일 동안 드세요.`} />
      <T h left={28} top={132}>
        며칠 드시나요?
      </T>
      <Row left={28} top={276}>
        <Icon name="calendar-days" />
        <T k>오늘부터</T>
      </Row>
      <T c={C.ink2} left={28} top={392}>
        {end.getMonth() + 1}월 {end.getDate()}일까지
      </T>
      <Stepper value={days} onChange={setDays} max={90} unit="일" />
      <Btn label="저장하기" onPress={back} />
    </Phone>
  );
}
