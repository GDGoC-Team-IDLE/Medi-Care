// 약봉투 등록 (찍기 → 읽기 → 회차 확인 → 주의 → 일정 시작) · 고치기 (회차 → 약 목록 → 약 하나 · 일수)
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { back, go, swap } from '@/lib/nav';
import { api, ApiError, TOKEN_KEYS, appendFile } from '@/lib/api';
import { getItem } from '@/lib/storage';
import { loadCurrentPatient } from '@/lib/currentPatient';
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

export type Slot = 'MORNING' | 'LUNCH' | 'DINNER' | 'BEDTIME';

type MealTiming = 'BEFORE' | 'AFTER' | 'ANY';
type SlotDose = {
  count_per_dose: number;
  meal_timing: MealTiming;
};
type PreviewDrug = SlotDose & {
  name: string;
  slots: Slot[];
  days: number;
};
type DraftDrug = PreviewDrug & { slotDoses?: Partial<Record<Slot, SlotDose>> };

/** 분석 결과와 등록 전에 바꾼 회차별 복용 정보 */
interface Preview {
  drugs: DraftDrug[];
  needs_retake: boolean;
  totalDays?: number;
}

function longestDrugDuration(draft: Preview): number {
  return Math.max(...draft.drugs.map((drug) => drug.days));
}

function draftDays(draft: Preview | null): number {
  return draft ? draft.totalDays ?? longestDrugDuration(draft) : 7;
}

function doseForSlot(drug: DraftDrug, slot?: Slot): SlotDose {
  return (slot && drug.slotDoses?.[slot]) || drug;
}

/** 등록 API는 항목 하나에 공통 수량을 받으므로 수량과 식사 시점이 같은 회차만 묶는다. */
function drugsForSave(draft: Preview): PreviewDrug[] {
  const originalDays = longestDrugDuration(draft);
  const totalDays = draftDays(draft);
  return draft.drugs.flatMap((drug) => {
    // 가장 긴 복용 기간을 바꾸고, 원래 더 짧은 약은 새 종료일을 넘지 않도록 한다.
    const days = drug.days === originalDays ? totalDays : Math.min(drug.days, totalDays);
    const groups: PreviewDrug[] = [];
    for (const slot of drug.slots) {
      const { count_per_dose, meal_timing } = doseForSlot(drug, slot);
      const group = groups.find((candidate) => candidate.count_per_dose === count_per_dose && candidate.meal_timing === meal_timing);
      if (group) {
        group.slots.push(slot);
      } else {
        groups.push({ name: drug.name, days, slots: [slot], count_per_dose, meal_timing });
      }
    }
    return groups;
  });
}

/** POST /patients/me/prescriptions 응답 (쓰는 칸만) */
interface Saved {
  end_date: string; // YYYY-MM-DD
  slots: { slot_date: string; slot: Slot }[]; // 날짜·시간 순
}

/** GET /patients/me/dur-warnings 응답 (쓰는 칸만). 병용금기가 맨 위로 온다 */
interface Dur {
  warnings: { type: string; drugs: string[]; easy_message: string }[];
  unidentified_drugs: string[];
  message: string;
}

/** 저장한 처방. 같은 분석 결과를 두 번 저장하지 않도록 어느 preview 를 저장했는지 함께 둔다 */
let saved: { from: Preview; who: string; res: Saved } | null = null;
/** p03 이 보여 줄 주의사항 */
let dur: Dur | null = null;

/**
 * 처방을 저장할 어르신. 어르신 폰(기기 토큰)이면 'me', 보호자 폰이면 마이페이지에서 선택한 어르신
 * (선택한 적이 없거나 그 어르신이 목록에 없으면 GET /patients 의 첫 어르신). 보호자에게 연결된 어르신이 없으면 null
 */
async function owner(): Promise<string | null> {
  if (await getItem(TOKEN_KEYS.device)) return 'me';
  const [{ patients }, cur] = await Promise.all([api.get<{ patients: { patient_id: number; paired: boolean }[] }>('/patients'), loadCurrentPatient()]);
  // 마이페이지에서 고른 어르신 → 없으면 폰이 연결된 어르신 중 가장 최근 → 그래도 없으면 첫 어르신
  // (첫 어르신이 기본이면 연결 안 된 예전 어르신에게 저장돼 어르신 화면이 안 바뀔 수 있다)
  const pick = patients.find((p) => p.patient_id === cur?.patient_id) ?? [...patients].reverse().find((p) => p.paired) ?? patients[0];
  return pick ? String(pick.patient_id) : null;
}

/** p23 '맞아요': 처방 저장 → 주의사항 조회. 주의할 게 있으면 p03, 없으면 p28 */
async function confirmPreview(p: Preview): Promise<string> {
  const prev = saved;
  const who = prev?.from === p ? prev.who : await owner();
  if (!who) return 'c02-device'; // 연결된 어르신이 없음 → 어르신 폰 설정부터
  if (prev?.from !== p) {
    const res = await api.post<Saved>(`/patients/${who}/prescriptions`, { drugs: drugsForSave(p) });
    saved = { from: p, who, res };
  }
  dur = await api.get<Dur>(`/patients/${who}/dur-warnings`);
  return dur.warnings.length || dur.unidentified_drugs.length ? 'p03-caution' : 'p28-start';
}

/** 저장·주의사항 실패 → 화면. 다시 해 보기는 회차 확인으로 (이미 저장했으면 저장은 건너뛴다) */
function saveFail(x: unknown): string {
  const status = x instanceof ApiError ? x.status : -1;
  if (status === 401) return 'c01-login'; // 로그인이 없거나 만료 · 연결이 끊긴 어르신 폰
  if (status === 403) return 'c02-device'; // 이 폰으로는 그 어르신에 접근할 수 없음 → 폰 설정
  if (status === 400) return 'p22-unsure'; // 알 수·일수가 서버 범위 밖이거나 오늘 남은 회차가 없음 → 보호자와 같이
  if (status === 0) return 'p15-offline?retry=p23-review';
  return 'p15t-slow?retry=p23-review'; // 503 MFDS_UNAVAILABLE 등
}

/** p12 에서 받은 등록 전 처방. 돌아갈 때 이미 열린 요약·목록도 변경을 받는다. */
let preview: Preview | null = null;
const previewListeners = new Set<() => void>();
const getPreview = () => preview;

function subscribePreview(listener: () => void) {
  previewListeners.add(listener);
  return () => { previewListeners.delete(listener); };
}

function setPreview(next: Preview | null) {
  preview = next;
  previewListeners.forEach((listener) => listener());
}

/** 장면(밑줄·칸 채우기)이 끝나는 시각. 응답이 빨리 와도 여기까지는 보여 준다 */
const SCENE_MS = 5900;
/** 이보다 오래 걸리면 p15t */
const SLOW_MS = 8000;

async function analyze(uri: string): Promise<Preview> {
  const form = new FormData();
  await appendFile(form, 'image', { uri, name: 'envelope.jpg' });
  return api.postForm<Preview>('/prescriptions/analyze', form);
}

/** 분석 실패 → 화면. 다시 해 보기가 약봉투 찍기로 오도록 retry 를 붙인다 */
function failRoute(x: unknown): string {
  const status = x instanceof ApiError ? x.status : -1;
  if (status === 401) return 'c01-login'; // 로그인도 기기 연결도 없음
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
    setPreview(null);
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
        setPreview(p);
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

export const SLOT_ROW: Record<Slot, { name: string; pouch: IllName }> = {
  MORNING: { name: '아침', pouch: 'pouch-morning' },
  LUNCH: { name: '점심', pouch: 'pouch-noon' },
  DINNER: { name: '저녁', pouch: 'pouch-evening' },
  BEDTIME: { name: '자기 전', pouch: 'pouch-blank' },
};
const SLOTS = Object.keys(SLOT_ROW) as Slot[];
const findSlot = (value?: string) => SLOTS.find((slot) => slot === value);
/** 읽어 줄 때 알 수는 고유어로 (두 알, 세 알) */
export const SAY_COUNT = ['영', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** 분석 결과 → 복용 일수 · 회차별 알 수. 결과가 없으면 예시(7일, 아침 2 · 점심 2 · 저녁 3) */
function summary(p: Preview | null): { days: number; rows: [Slot, number][] } {
  if (!p) return { days: 7, rows: [['MORNING', 2], ['LUNCH', 2], ['DINNER', 3]] };
  const rows = SLOTS
    .map((s): [Slot, number] => [s, p.drugs.filter((d) => d.slots.includes(s)).reduce((n, d) => n + doseForSlot(d, s).count_per_dose, 0)])
    .filter(([, n]) => n > 0);
  return { days: draftDays(p), rows };
}

/** p23 회차 요약. 행 → 그 회차의 약 목록, 제목 → 복용 일수 */
export function Review() {
  const draft = useSyncExternalStore(subscribePreview, getPreview, getPreview);
  const { days, rows } = summary(draft);
  const four = rows.length > 3; // 자기 전까지 네 줄이면 버튼에 닿지 않게 좁힌다
  const said = rows.map(([s, n]) => `${SLOT_ROW[s].name} ${SAY_COUNT[n] ?? n} 알`).join(', ');
  const busy = useRef(false); // 두 번 눌러도 한 번만 저장
  const [saving, setSaving] = useState(false);
  const canEditDays = !draft || saved?.from !== draft;
  const ok = async () => {
    if (!preview) return go('p03-caution'); // 화면 목록에서 연 예시는 예전처럼
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      go(await confirmPreview(preview));
    } catch (x) {
      swap(saveFail(x));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Phone>
      <Back />
      <Say text={`${days}일치 약이에요. ${said}. 맞으면 맞아요를 눌러 주세요.`} />
      <Tap disabled={!canEditDays || saving} onPress={() => {
        if (!busy.current) go('p25d-days');
      }} style={[abs({ left: 28, top: 121, height: 60 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <T h>{days}일치 약</T>
        {canEditDays && <Icon name="chevron-right" />}
      </Tap>
      {rows.map(([s, n], i) => (
        <SlotRow key={s} i={i} top={(four ? 204 : 228) + i * (four ? 100 : 120)} pouch={SLOT_ROW[s].pouch} name={SLOT_ROW[s].name} count={`${n}알`} onPress={() => {
          if (!busy.current) go(draft ? `p23b-slot?slot=${s}` : 'p23b-slot');
        }} />
      ))}
      <Btn two label={saving ? '확인하는 중' : '맞아요'} onPress={() => void ok()} />
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

const WARN: Record<string, { icon: IconName; title: string }> = {
  CONCOMITANT_CONTRAINDICATION: { icon: 'triangle-alert', title: '같이 드시면 안 돼요' },
  ELDERLY_CAUTION: { icon: 'circle-alert', title: '어르신은 조심해서 드세요' },
  DUPLICATE_EFFICACY: { icon: 'pill', title: '비슷한 약이 겹쳐요' },
};

/** p03 서버 주의사항. 몇 건일지 몰라 버튼 위 칸에서 스크롤한다. 마지막 줄은 서버 안내(정보를 못 찾은 약 등) */
function DurCautions({ d }: { d: Dur }) {
  const items = d.warnings.map((w) => ({ ...(WARN[w.type] ?? { icon: 'circle-alert' as IconName, title: '주의하세요' }), drugs: w.drugs.join(' · '), tell: w.easy_message }));
  const said = [...items.map((w) => `${w.title}. ${w.drugs}. ${w.tell}`), d.message].join(' ');
  return (
    <Phone>
      <Back />
      <Say text={said} />
      <ScrollView style={abs({ left: 0, right: 0, top: 132, height: 540 })} contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: 16, gap: 28 }}>
        {items.map((w, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
            <Icon name={w.icon} c={C.ink2} />
            <View style={{ flex: 1, gap: 4 }}>
              <T k>{w.title}</T>
              <T>{w.drugs}</T>
              <T c={C.ink2}>{w.tell}</T>
            </View>
          </View>
        ))}
        <T c={C.ink2}>{d.message}</T>
      </ScrollView>
      <Btn label="알겠어요" onPress={() => go('p28-start')} />
    </Phone>
  );
}

/** p03 주의사항. DUR 3종: 병용금기(맨 위, 크게) · 노인주의 · 효능군 중복. 저장한 처방이 없으면(화면 목록) 예시 */
export function CautionScreen() {
  if (dur) return <DurCautions d={dur} />;
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

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const md = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
/** 첫 회차 날짜를 '오늘' · '내일' · '11월 26일' 로 */
function dayWord(date: string): string {
  const d = new Date();
  if (date === ymd(d)) return '오늘';
  d.setDate(d.getDate() + 1);
  return date === ymd(d) ? '내일' : md(date);
}
const TRAY_SLOTS: Slot[] = ['MORNING', 'LUNCH', 'DINNER'];

/** p28 일정 시작. 등록 시각이 지난 회차(오늘 아침)는 서버가 만들지 않는다. 저장한 처방이 없으면(화면 목록) 예시 */
export function Start() {
  const res = saved?.res;
  const first = res?.slots[0];
  const day = first ? dayWord(first.slot_date) : '오늘';
  const from = first ? `${SLOT_ROW[first.slot].name}부터` : '점심부터';
  const until = res ? `${md(res.end_date)}까지` : '11월 26일까지';
  const tray: ('plan' | 'none')[] = first && res ? TRAY_SLOTS.map((s) => (res.slots.some((x) => x.slot_date === first.slot_date && x.slot === s) ? 'plan' : 'none')) : ['none', 'plan', 'plan'];
  const f = first ? TRAY_SLOTS.indexOf(first.slot) : 1; // 자기 전이면 -1 → 고른 칸 없음
  return (
    <Phone>
      <Back />
      <Say icon text={`${day} ${from} 시작해요. ${until} 드세요.`} />
      <Tray slots={tray} f={f >= 0 ? f : undefined} now={0.3} />
      <Up delay={0.6}>
        <T s={32} k c={C.plan} center top={336}>
          {day}
        </T>
      </Up>
      <Up delay={0.7}>
        <T s={56} k lh={1} center top={384}>
          {from}
        </T>
      </Up>
      <Up delay={0.7}>
        <T c={C.ink2} center top={472}>
          {until}
        </T>
      </Up>
      {/* 보호자 폰에서 등록했으면 보호자 오늘로, 어르신 폰이면 어르신 오늘로 */}
      <Btn up={0.85} label="시작하기" onPress={() => swap(saved && saved.who !== 'me' ? 'g01-today' : 'p04-today')} />
    </Phone>
  );
}

const MEAL_LABEL: Record<MealTiming, string> = { BEFORE: '식전', AFTER: '식후', ANY: '식사와 무관' };
const EXAMPLE_DRUGS: PreviewDrug[] = [
  { name: '다이아벡스정', count_per_dose: 1, slots: ['MORNING', 'LUNCH'], meal_timing: 'AFTER', days: 7 },
  { name: '스티렌정', count_per_dose: 1, slots: ['MORNING', 'LUNCH'], meal_timing: 'AFTER', days: 7 },
];
const DRUG_ILLUSTRATIONS: IllName[] = ['pill-capsule', 'pill-round-blue'];

function DrugRow({ name, dose, onPress, i }: { name: string; dose: SlotDose; onPress?: () => void; i: number }) {
  return (
    <Tap onPress={onPress} disabled={!onPress} style={{ minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Pop delay={250 + i * 90}>
        <Ill name={DRUG_ILLUSTRATIONS[i % DRUG_ILLUSTRATIONS.length]} />
      </Pop>
      <View style={{ flex: 1 }}>
        <T k>{name}</T>
        <T c={C.ink2}>{MEAL_LABEL[dose.meal_timing]}</T>
      </View>
      <T s={32} k>
        {dose.count_per_dose}알
      </T>
      {onPress && <Icon name="chevron-right" style={CHEV} />}
    </Tap>
  );
}

/** p23b 그 회차에 든 약 목록 */
export function SlotDrugs() {
  const { slot } = useLocalSearchParams<{ slot?: string }>();
  const draft = useSyncExternalStore(subscribePreview, getPreview, getPreview);
  const selectedSlot = findSlot(slot);
  const current = selectedSlot ? draft : null;
  const name = SLOT_ROW[selectedSlot ?? 'LUNCH'].name;
  const drugs = (current?.drugs ?? EXAMPLE_DRUGS)
    .map((drug, index) => ({ drug, index }))
    .filter(({ drug }) => !selectedSlot || drug.slots.includes(selectedSlot))
    .map(({ drug, index }) => ({ name: drug.name, index, dose: doseForSlot(drug, selectedSlot) }));
  const total = drugs.reduce((sum, { dose }) => sum + dose.count_per_dose, 0);
  const list = drugs.map(({ name: drugName, dose }) => `${drugName} ${SAY_COUNT[dose.count_per_dose] ?? dose.count_per_dose} 알`).join(', ');
  const canEdit = !current || saved?.from !== current;
  return (
    <Phone>
      <Back />
      <Say text={`${name} 약은 ${SAY_COUNT[total] ?? total} 알이에요. ${list}`} />
      <T h left={28} top={132}>
        {name} {total}알
      </T>
      <ScrollView style={abs({ left: 28, right: 28, top: 228, height: 440 })} contentContainerStyle={{ gap: 24, paddingRight: 12 }}>
        {drugs.map(({ name: drugName, index, dose }, i) => (
          <DrugRow key={index} name={drugName} dose={dose} i={i}
            onPress={canEdit ? () => go(current ? `p25-drug?slot=${selectedSlot}&drugIndex=${index}` : 'p25-drug') : undefined} />
        ))}
      </ScrollView>
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

/** 고르는 칸: 켜짐 = 글자 검정 + 아래 4px 막대 */
function Toggle({ on, icon, label, row, disabled, onPress }: { on: boolean; icon: IconName; label: string; row?: boolean; disabled?: boolean; onPress: () => void }) {
  const c = on ? C.ink : C.plan;
  return (
    <Tap
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
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
  const { drugIndex, slot } = useLocalSearchParams<{ drugIndex?: string; slot?: string }>();
  const draft = useSyncExternalStore(subscribePreview, getPreview, getPreview);
  const index = drugIndex !== undefined && /^\d+$/.test(drugIndex) ? Number(drugIndex) : -1;
  const drug = draft?.drugs[index];
  const selectedSlot = findSlot(slot);
  const editingSlot = selectedSlot && drug?.slots.includes(selectedSlot) ? selectedSlot : undefined;
  const save = (slots: Slot[], dose: SlotDose) => {
    if (draft && drug && editingSlot && draft === preview && saved?.from !== draft) {
      const slotDoses = { ...drug.slotDoses, [editingSlot]: dose };
      for (const previous of drug.slots) {
        if (!slots.includes(previous)) delete slotDoses[previous];
      }
      const drugs = draft.drugs.slice();
      drugs[index] = { ...drug, slots, slotDoses };
      setPreview({ ...draft, drugs });
    }
    back();
  };
  return <DrugEditor key={`${editingSlot}-${index}`} drug={drug ?? EXAMPLE_DRUGS[1]} editingSlot={editingSlot} onSave={save} />;
}

const SLOT_ICON: Record<Slot, IconName> = { MORNING: 'sunrise', LUNCH: 'sun', DINNER: 'moon', BEDTIME: 'moon' };
const MEAL_ICON: Record<MealTiming, IconName> = { BEFORE: 'c-meal-before', AFTER: 'c-meal-after', ANY: 'clock' };

function DrugEditor({ drug, editingSlot, onSave }: {
  drug: DraftDrug;
  editingSlot?: Slot;
  onSave: (slots: Slot[], dose: SlotDose) => void;
}) {
  const dose = doseForSlot(drug, editingSlot);
  const [slots, setSlots] = useState(drug.slots);
  const [meal, setMeal] = useState(dose.meal_timing);
  const [count, setCount] = useState(dose.count_per_dose);
  const slotName = editingSlot && SLOT_ROW[editingSlot].name;
  return (
    <Phone>
      <Back />
      <Say text={`${drug.name}. ${slotName ? `${slotName}에 드시는 개수를 고칠 수 있어요.` : '드시는 때와 개수를 고칠 수 있어요.'}`} />
      <T h left={28} right={28} top={132} fit={334}>
        {drug.name}
      </T>
      {slotName && <T k left={28} top={205}>{slotName} 회차 편집</T>}
      <View style={[abs({ left: 28, right: 28, top: 260, height: 96 }), { flexDirection: 'row', gap: 8 }]}>
        {SLOTS.map((slot) => {
          const on = slots.includes(slot);
          return <Toggle key={slot} on={on} icon={SLOT_ICON[slot]} label={SLOT_ROW[slot].name}
            disabled={slot === editingSlot || (on && slots.length === 1)}
            onPress={() => setSlots(on ? slots.filter((value) => value !== slot) : [...slots, slot])} />;
        })}
      </View>
      <View style={[abs({ left: 28, right: 28, top: 380, height: 60 }), { flexDirection: 'row', gap: 8 }]}>
        {(Object.keys(MEAL_LABEL) as MealTiming[]).map((timing) => (
          <Toggle key={timing} row={timing !== 'ANY'} on={meal === timing} icon={MEAL_ICON[timing]}
            label={MEAL_LABEL[timing]} onPress={() => setMeal(timing)} />
        ))}
      </View>
      <Stepper value={count} onChange={setCount} max={10} unit="알" />
      <Btn label="저장하기" onPress={() => onSave(slots, { count_per_dose: count, meal_timing: meal })} />
    </Phone>
  );
}

/** p25d 복용 일수. 끝 날짜는 계산값(오늘 + 일수 − 1) */
export function Days() {
  const draft = useSyncExternalStore(subscribePreview, getPreview, getPreview);
  const [days, setDays] = useState(() => Math.min(draftDays(draft), 90));
  const end = new Date();
  end.setDate(end.getDate() + days - 1);
  const save = () => {
    if (draft && draft === preview && saved?.from !== draft && draftDays(draft) !== days) {
      setPreview({ ...draft, totalDays: days });
    }
    back();
  };
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
      <Btn label="저장하기" onPress={save} />
    </Phone>
  );
}
