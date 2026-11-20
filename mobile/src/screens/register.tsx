// 약봉투 등록 (찍기 → 읽기 → 회차 확인 → 주의 → 일정 시작) · 고치기 (회차 → 약 목록 → 약 하나 · 일수)
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { back, go, swap } from '@/lib/nav';
import { C } from '@/constants/theme';
import { Icon, Ill, Phone, Row, T, Tap, abs, type IconName, type IllName } from '@/components/core';
import { Arc, Back, Btn, Ring, Say, Shutter, Sub, Viewfinder } from '@/components/parts';

/** 행 끝의 ›: 보이는 선의 오른쪽 끝이 끝선 28 에 오게 당긴다 */
const CHEV = { marginRight: -12 };

/** p01 약봉투 찍기. 보호자가 대신 찍어도 된다 */
export function Scan() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <Say text="약봉투를 글씨가 보이게 펴서 찍어 주세요." />
      <Row center top={128}>
        <Icon name="c-envelope-rx" />
        <T s={32} k>
          약봉투
        </T>
      </Row>
      <T k center top={176}>
        글씨가 보이게 펴서
      </T>
      <Viewfinder photo="photo-envelope" />
      <Shutter onPress={() => go('p12-reading')} />
    </Phone>
  );
}

/** p12 읽는 중. 8초를 넘으면 p15t(오래 걸려요)로 넘어간다 */
export function Reading() {
  useEffect(() => {
    const t = setTimeout(() => swap('p23-review'), 1800);
    return () => clearTimeout(t);
  }, []);
  return (
    <Phone>
      <Back close />
      <Ring photo="photo-envelope" title="읽는 중" />
    </Phone>
  );
}

function SlotRow({ top, pouch, name, count, onPress }: { top: number; pouch: IllName; name: string; count: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <Ill name={pouch} />
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

/** p23 회차 요약. 행 → 그 회차의 약 목록, 제목 → 복용 일수 */
export function Review() {
  return (
    <Phone>
      <Back />
      <Say text="칠 일치 약이에요. 아침 두 알, 점심 두 알, 저녁 세 알. 맞으면 맞아요를 눌러 주세요." />
      <Tap onPress={() => go('p25d-days')} style={[abs({ left: 28, top: 121, height: 60 }), { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <T h>7일치 약</T>
        <Icon name="chevron-right" />
      </Tap>
      <SlotRow top={228} pouch="pouch-morning" name="아침" count="2알" onPress={() => go('p23b-slot')} />
      <SlotRow top={348} pouch="pouch-noon" name="점심" count="2알" onPress={() => go('p23b-slot')} />
      <SlotRow top={468} pouch="pouch-evening" name="저녁" count="3알" onPress={() => go('p23b-slot')} />
      <Btn two label="맞아요" onPress={() => go('p03-caution')} />
      <Sub label="모르겠어요" onPress={() => go('p22-unsure')} />
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
  tell: '다른 병원 약에 있으면 약사에게 물어요',
};

const OTHER_CAUTIONS = [
  { top: 388, icon: 'circle-alert', title: '어지러울 수 있어요', tell: '천천히 일어나요' },
  { top: 484, icon: 'pill', title: '위장약이 겹쳐요', tell: '약사에게 물어요' },
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
        <Ill name="pill-scored" />
        <Ill name="pill-oval" />
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
      <Arc slots={['none', 'plan', 'plan']} focus={1} now={0.3} />
      <T s={32} k c={C.plan} center top={304}>
        오늘
      </T>
      <T s={56} k lh={1} center top={344}>
        점심부터
      </T>
      <T c={C.ink2} center top={504}>
        11월 26일까지
      </T>
      <Btn label="확인" onPress={() => swap('p04-today')} />
    </Phone>
  );
}

function DrugRow({ top, pill, name, onPress }: { top: number; pill: IllName; name: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <Ill name={pill} />
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
      <DrugRow top={348} pill="pill-round-blue" name="스티렌정" onPress={() => go('p25-drug')} />
      <Btn label="됐어요" onPress={back} />
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
  const round = { width: 96, height: 96, borderRadius: 48, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={[abs({ left: 28, right: 28, top: 504, height: 96 }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      <Tap accessibilityLabel="빼기" onPress={() => onChange(Math.max(min, value - 1))} style={round}>
        <Icon name="minus" size={40} />
      </Tap>
      <T s={84} num>
        {value}
        {unit}
      </T>
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
      <Btn label="됐어요" onPress={back} />
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
        며칠 드세요?
      </T>
      <Row left={28} top={276}>
        <Icon name="calendar-days" />
        <T k>오늘부터</T>
      </Row>
      <T c={C.ink2} left={28} top={392}>
        {end.getMonth() + 1}월 {end.getDate()}일까지
      </T>
      <Stepper value={days} onChange={setDays} max={90} unit="일" />
      <Btn label="됐어요" onPress={back} />
    </Phone>
  );
}
