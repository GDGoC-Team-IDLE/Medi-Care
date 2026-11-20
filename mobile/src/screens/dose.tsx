// 알림 · 약 없음 · 인증 촬영 · 판정 5종 · 실패/연결 없음 · 카메라 권한
import { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { back, go, swap } from '@/lib/nav';
import { GUARDIAN, call } from '@/lib/mock';
import { C } from '@/constants/theme';
import { Icon, Phone, Row, T, Tap, Up, abs, type IconName } from '@/components/core';
import { Fig3 } from '@/components/figure';
import { Back, Badge, Blink, Btn, Burst, CamTitle, Fig, Lock, PillNoti, Say, ScanCard, Sheet, Shutter, Stop, Sub, Torch, Verdict, Viewfinder, type ScanSpec } from '@/components/parts';

const shoot = () => go('p06-shoot');
const told = `${GUARDIAN}에게 알렸어요`;
const callG = `${GUARDIAN}에게 전화하기`;

/* ── 알림 (기본 = 일반 알림 → 5분 뒤 다시, 잠금화면 알람은 보호자가 켠 시간대만) ── */
/** p17 일반 알림. 누르면 잠금 해제 뒤 바로 촬영 */
export function Notice() {
  return (
    <Phone bg={C.lock} fg={C.white}>
      <Lock time="12:30">
        <PillNoti when="지금" title="점심 2알" onPress={shoot} />
      </Lock>
    </Phone>
  );
}

/** p17b 5분 무응답 → 같은 알림을 큰 소리·음성으로 다시. 15분 → 보호자(g10) */
export function NoticeAgain() {
  return (
    <Phone bg={C.lock} fg={C.white}>
      <Lock time="12:35">
        <PillNoti loud when="다시" title="점심 2알" body="5분 지났어요" onPress={shoot} />
      </Lock>
    </Phone>
  );
}

/** 잘못 눌러도 해 없는 안전 3칸 (552–632, 찍기 위). 칸이 좁아 '다시 알림'의 10분은 시계 그림만 */
function Safe3() {
  const items: [IconName, string, () => void][] = [
    ['c-pouch', '약 없어요', () => go('p32-nomed')],
    ['alarm-clock', '다시 알림', back],
    ['phone', GUARDIAN, call],
  ];
  return (
    <View style={[abs({ left: 29, top: 552, width: 332, height: 80 }), { flexDirection: 'row', gap: 16 }]}>
      {items.map(([icon, label, onPress]) => (
        <Tap key={label} onPress={onPress} style={{ width: 100, height: 80, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name={icon} c={C.ink2} />
          <T c={C.ink2}>{label}</T>
        </Tap>
      ))}
    </View>
  );
}

/** 알람 머리: 가장 큰 글자는 회차·알 수. 식사에 약을 묶는 사람에게 시계는 덜 중요하다(context.md) */
function AlarmHead({ time }: { time: string }) {
  return (
    <>
      <Row center top={160}>
        <Icon name="sun" />
        <T s={32} k lh={1}>
          {time}
        </T>
      </Row>
      <T s={84} num center top={200}>
        점심 2알
      </T>
    </>
  );
}

/** p05 잠금화면 알람. 사진을 찍어야 꺼진다. 찍기는 엄지 자리(680–792), 안전 3칸은 그 위 */
export function Alarm() {
  return (
    <Phone bg={C.sun}>
      <AlarmHead time="12:30" />
      <Fig3 name="pouch-noon@150" motion="am-ring" w={180} h={180} style={abs({ left: 105, top: 324 })} />
      <Btn kind="al" icon="camera" label="찍기" onPress={shoot} />
      <Safe3 />
    </Phone>
  );
}

/** p05b 5분 무응답 → 큰 소리·음성. 15분이면 보호자에게 */
export function AlarmLoud() {
  return (
    <Phone bg={C.sun}>
      <AlarmHead time="12:35" />
      <Row center top={300}>
        <Blink times={99} delay={0.5}>
          <Icon name="volume-2" />
        </Blink>
        <T k>소리 나는 중</T>
      </Row>
      <Fig3 name="pouch-noon@150" motion="am-ring loud" w={120} h={120} style={abs({ left: 135, top: 348 })} />
      <T c={C.ink2} center top={488}>
        곧 {GUARDIAN}에게 알려요
      </T>
      <Btn kind="al" icon="camera" label="찍기" onPress={shoot} />
      <Safe3 />
    </Phone>
  );
}

/** p32 '약 없어요' → 보호자에게 알림(g11c). 전화가 걸린 것은 아니다. 확인 → p32b */
export function NoMed() {
  return (
    <Phone>
      <Back close onPress={() => swap('p32b-afternomed')} />
      <Fig fig="pouch-open@240" motion="am-tip" />
      <Badge icon="bell" />
      <Verdict readAloud mv={false} title="약이 없어요" tell={told} />
      <Btn two label="확인" onPress={() => swap('p32b-afternomed')} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p34 보호자가 알림 방식을 바꾼 뒤, 다음 알람 전에 한 번. 열리면 바로 읽어 준다 */
export function AlarmNew() {
  return (
    <Phone>
      <Fig fig="phone-ring@240" motion="am-wave" />
      <Badge icon="alarm-clock" />
      <Verdict readAloud mv={false} title="알림이 바뀌어요" tell="점심·저녁은 화면 가득 울려요" line={`${GUARDIAN}이 바꿨어요`} />
      <Btn label="확인" onPress={() => swap('p04-today')} />
    </Phone>
  );
}

/* ── 인증 촬영 ── */
/** p30 이미 완료된 회차의 촬영 화면을 열었을 때: 찍기 전에 막는다. 기록·알림 없음 → 손은 먹색 */
export function Before() {
  return (
    <Phone>
      <Back close />
      <Fig name="photo-palm-noon-2" left={105} width={180} />
      <Stop ink />
      <Verdict readAloud mv={false} title="이미 드신 약이에요" tell="점심은 12:31에 드셨어요" />
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

const NOON = { icon: 'sun', title: '점심 2알' } as const;

/** p06 인증 촬영. 흰 점선 = 놓을 자리(위 약포, 아래 손바닥) */
export function Shoot() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close onPress={() => swap('p04-today')} />
      <CamTitle {...NOON} />
      <Viewfinder guide photo="photo-palm-noon-2" />
      <Shutter onPress={() => go('p18-checking')} />
      <Say cam text="점심 약 두 알. 봉투는 위에, 약은 손바닥에 놓고 찍어 주세요." />
    </Phone>
  );
}

/** p06b 찍기 전 밝기 부족 (앱 로컬 감지) */
export function ShootDark() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <CamTitle {...NOON} warn tell="불을 켜 주세요" />
      <Viewfinder dark photo="photo-palm-noon-2" lock={null} />
      <Torch />
      <Shutter at={null} onPress={() => go('p18-checking')} />
      <Say cam text="어두워요. 불을 켜 주세요." />
    </Phone>
  );
}

/** p18 표시 위치(사진 좌표 300×400). 앱에서는 Gemini 응답의 상자(0~1 비율) × 사진 크기 */
const CHECK: ScanSpec = {
  photo: 'photo-palm-noon-2',
  glints: [
    ['<rect x="10" y="14" width="120" height="44" rx="14" transform="translate(14 172) rotate(-7) scale(.82)"/>', 0.66],
    ['<circle cx="215" cy="193" r="19"/>', 1.26],
    ['<ellipse cx="190" cy="231" rx="31" ry="16" transform="rotate(-28 190 231)"/>', 1.38],
  ],
  frame: { d: 'M6.8 181.3V165.3A12 12 0 0 1 18.8 153.3h16M107.8 153.3h16a12 12 0 0 1 12 12v16M135.8 234.6v16a12 12 0 0 1 -12 12h-16M34.8 262.6H18.8a12 12 0 0 1 -12 -12v-16', rotate: 'rotate(-7 71.3 207.9)', at: 1 },
  marks: [
    ['<path d="M64 202.2L111.2 196.4"/>', 4.45],
    ['<ellipse cx="190" cy="231" rx="34" ry="19" transform="rotate(-28 190 231)"/>', 4.75],
    ['<circle cx="215" cy="193" r="21"/>', 5.05],
  ],
  slots: [
    ['pill-capsule', 1.6, 4.85],
    ['pill-round-blue', 2.6, 5.15],
  ],
};

/** p18 보는 중. Gemini 는 봉투 시간 표시·알약 개수만 읽고 판정은 서버 규칙. 8초를 넘으면 p15t */
export function Checking() {
  useEffect(() => {
    const t = setTimeout(() => swap('p07-ok'), 5900);
    return () => clearTimeout(t);
  }, []);
  return (
    <Phone>
      <Back close />
      <ScanCard spec={CHECK} title="확인하고 있어요" />
    </Phone>
  );
}

/* ── 판정 5종 (OK = 회차 완료). 그림 → 표시(멈춤 손·고리) → 글 → 버튼 ── */
/** p07 OK: 물이 차오르고 알약 둘이 차례로 떨어진다 */
export function Ok() {
  return (
    <Phone bg={C.ok} fg={C.white}>
      <Burst />
      <Fig fig="verdict-ok@240" motion="vk-ok" left={75} top={152} width={240} height={200} />
      <Verdict readAloud title="맞아요, 드세요" tell="점심 12:31 완료" line="다음은 저녁 식후" lineIcon="moon" />
      <Btn up={0.32} kind="w" label="확인" onPress={() => swap('p19-wait')} />
    </Phone>
  );
}

/** p08 WRONG_TIME: 화살표가 저녁 봉투에서 점심 봉투로, 저녁 봉투가 들썩인다 */
export function WrongTime() {
  return (
    // 6판: 멈춤은 화면 전체 빨강 — 맞아요(초록)와 같은 무게, 다시 찍기(흰 바탕)와 한눈에 갈린다
    <Phone bg={C.wrong} fg={C.white}>
      <Back close />
      <Fig fig="verdict-wrong-time@334" motion="vk-wt" />
      <Stop />
      <Verdict readAloud title="저녁 약이에요" tell="드시지 말고 봉투에 넣어 두세요" line={told} lineIcon="bell" />
      <Btn up={0.32} two kind="w" icon="camera" label="점심 봉투 찍기" onPress={shoot} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p09 ALREADY_TAKEN: 점심을 찍을 차례에 8:12 에 먹은 아침 봉투를 또 찍음. 뜯긴 윗부분이 떨어져 나가고 빈 봉투가 흔들린다 */
export function Already() {
  return (
    <Phone bg={C.wrong} fg={C.white}>
      <Back close />
      <Fig fig="verdict-already@307" motion="vk-al" />
      <Stop />
      <Verdict readAloud title="아침 약은 드셨어요" tell="드시지 말고 봉투에 넣어 두세요" line={told} lineIcon="bell" />
      <Btn up={0.32} two kind="w" label="확인" onPress={() => swap('p04-today')} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p10 COUNT_MISMATCH. 개수만 비교한다. 있는 알약이 나오고 빈 자리 점선이 깜빡인다 */
export function Count() {
  return (
    <Phone bg={C.wrong} fg={C.white}>
      <Back close />
      <Fig fig="verdict-count@270" motion="vk-ct" width={270} height={200} />
      <Stop />
      <Up delay={0.14}>
        <T k center top={340}>
          사진 1알 · 드실 약 2알
        </T>
      </Up>
      <Verdict readAloud title="1알이 모자라요" tell="다시 세어 보세요" line={told} lineIcon="bell" />
      <Btn up={0.32} two kind="w" icon="camera" label="다시 찍기" onPress={shoot} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p11 RETAKE. 회차 상태는 그대로, 보호자 알림 없음 → 손은 먹색. 폰이 흔들리고 다시 화살표가 돈다 */
export function Retake() {
  return (
    <Phone>
      <Back close />
      <Fig fig="verdict-retake@262" motion="vk-rt" />
      <Stop ink />
      <Verdict readAloud title="다시 찍어 주세요" tell="흔들리지 않게 찍어 주세요" />
      <Btn up={0.32} two icon="camera" label="다시 찍기" onPress={shoot} />
      <Sub up={0.38} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/* ── 실패 · 연결 없음 (판정 틀 + 삽화 + 원인 배지) ── */
/** p13 등록 추출 실패: 봉투 글씨가 흐려졌다 돌아온다 */
export function NoRead() {
  return (
    <Phone>
      <Back close />
      <Fig fig="envelope@240" motion="am-dim" />
      <Badge icon="eye" />
      <Verdict readAloud mv={false} title="글씨가 안 보여요" tell="봉투를 펴서 다시 찍어 주세요" />
      <Btn two icon="camera" label="다시 찍기" onPress={() => swap('p01-scan')} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p22 '잘 모르겠어요' 뒤: 봉투가 갸웃한다 */
export function Unsure() {
  return (
    <Phone>
      <Back />
      <Fig fig="envelope@240" motion="am-ask" />
      <Badge icon="circle-help" />
      <Verdict readAloud mv={false} title={`${GUARDIAN}과 같이 보세요`} tell={`${GUARDIAN}에게 전화해 보세요`} line={`${GUARDIAN} 폰으로 찍어도 돼요`} />
      <Btn two icon="phone" label={callG} onPress={call} />
      <Sub icon="camera" label="다시 찍기" onPress={() => swap('p01-scan')} />
    </Phone>
  );
}

/** 다시 해 보기: 약봉투 등록에서 왔으면(?retry=p01-scan) 약봉투 찍기로, 아니면 인증 촬영으로 */
function useRetry() {
  const { retry } = useLocalSearchParams<{ retry?: string }>();
  return () => swap(retry === 'p01-scan' ? 'p01-scan' : 'p06-shoot');
}

/** p15 연결 없음. 판정이 없으면 먹으라고 하지 않는다. 알약이 약포로 돌아가 앉는다 */
export function Offline() {
  const retry = useRetry();
  return (
    <Phone>
      <Back close />
      <Fig fig="pouch-noon@240" motion="am-rest" />
      <Badge icon="wifi-off" blink />
      <Verdict readAloud mv={false} title="인터넷이 안 돼요" tell="약은 봉투에 두세요" line="잠시 뒤 다시 해 보세요" />
      <Btn two icon="refresh-cw" label="다시 해 보기" onPress={retry} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p15t 서버 응답이 8초를 넘을 때: 폰 화면 모서리가 깜빡이며 기다린다 */
export function Slow() {
  const retry = useRetry();
  return (
    <Phone>
      <Back close />
      <Fig fig="phone-shoot@240" motion="am-wait" />
      <Badge icon="clock" beat />
      <Verdict readAloud mv={false} title="오래 걸려요" tell="약은 봉투에 두세요" line="잠시 뒤 다시 해 보세요" />
      <Btn two icon="refresh-cw" label="다시 해 보기" onPress={retry} />
      <Sub icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p14 카메라 권한 거절. 촬영 화면 위 시트로 올려 어디서 막혔는지 보이게. 켜기 = 앱 설정 열기 */
export function NoCam() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <CamTitle {...NOON} top={106} />
      <Viewfinder off lock={null} />
      <Say text="카메라가 꺼져 있어요. 켜야 약을 찍을 수 있어요." />
      <Sheet>
        <Badge icon="camera-off" left={167} top={452} />
        <T h center top={532}>
          카메라가 꺼져 있어요
        </T>
        <T k center top={590}>
          켜야 약을 찍을 수 있어요
        </T>
        <Btn icon="settings" label="카메라 켜기" onPress={() => Linking.openSettings().catch(() => {})} />
      </Sheet>
    </Phone>
  );
}
