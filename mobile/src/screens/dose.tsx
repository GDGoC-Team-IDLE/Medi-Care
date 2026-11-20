// 알림 · 인증 촬영 · 판정 5종 · 실패/연결 없음 · 카메라 권한
import { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { back, go, swap } from '@/lib/nav';
import { call } from '@/lib/mock';
import { C } from '@/constants/theme';
import { Icon, Ill, Phone, Row, T, Tap, abs, type IconName } from '@/components/core';
import { Back, Badge, Btn, Fig, Lock, PillNoti, Ring, Say, Shutter, Stop, Sub, Verdict, Viewfinder } from '@/components/parts';

const shoot = () => go('p06-shoot');

/* ── 알림 (기본 = 일반 알림 → 5분 뒤 다시, 잠금화면 알람은 보호자가 켠 시간대만) ── */
/** p17 일반 알림. 누르면 잠금 해제 뒤 바로 촬영 */
export function Notice() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:30">
        <PillNoti when="지금" title="점심 2알" onPress={shoot} />
      </Lock>
    </Phone>
  );
}

/** p17b 5분 무응답 → 같은 알림을 큰 소리·음성으로 다시 */
export function NoticeAgain() {
  return (
    <Phone bg={C.night} fg={C.white}>
      <Lock time="12:35">
        <PillNoti when="다시" title="점심 2알" body="5분 지남" onPress={shoot} />
      </Lock>
    </Phone>
  );
}

function Safe3() {
  const items: [IconName, string, () => void][] = [
    ['alarm-clock', '10분 뒤', back],
    ['c-pouch', '약 없음', () => go('p32-nomed')],
    ['phone', '보호자', call],
  ];
  return (
    <View style={[abs({ left: 29, top: 712, width: 332, height: 80 }), { flexDirection: 'row', gap: 16 }]}>
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

/** p05 잠금화면 알람. 사진을 찍어야 꺼진다 */
export function Alarm() {
  return (
    <Phone bg={C.sun}>
      <AlarmHead time="12:30" />
      <Ill name="pouch-noon" w={180} style={abs({ left: 105, top: 324 })} />
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
        <Icon name="volume-2" />
        <T k>소리 나는 중</T>
      </Row>
      <Ill name="pouch-noon" w={120} style={abs({ left: 135, top: 348 })} />
      <T c={C.ink2} center top={488}>
        곧 보호자에게 알려요
      </T>
      <Btn kind="al" icon="camera" label="찍기" onPress={shoot} />
      <Safe3 />
    </Phone>
  );
}

/** p32 '약 없음' → 보호자에게 알림. 전화가 걸린 것은 아니다 */
export function NoMed() {
  return (
    <Phone>
      <Back close />
      <Say text="약이 없어요. 보호자에게 알림을 보냈어요. 전화하려면 아래를 눌러 주세요." />
      <Fig name="pouch-open" />
      <Badge icon="bell" />
      <Verdict title="약이 없어요" tell="보호자에게 알림을 보냈어요" line="전화는 아래를 눌러요" />
      <Btn two label="확인" onPress={() => swap('p04-today')} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p34 보호자가 알림 방식을 바꾼 뒤, 다음 알람 전에 한 번 */
export function AlarmNew() {
  return (
    <Phone>
      <Say text="알림이 바뀌어요. 점심과 저녁은 화면 가득 울려요. 보호자가 바꿨어요." />
      <Fig name="phone-ring" />
      <Badge icon="alarm-clock" />
      <Verdict title="알림이 바뀌어요" tell="점심·저녁은 화면 가득 울려요" line="보호자가 바꿨어요" />
      <Btn label="확인" onPress={() => swap('p04-today')} />
    </Phone>
  );
}

/* ── 인증 촬영 ── */
/** p30 이미 완료된 회차의 촬영 화면을 열었을 때: 찍기 전에 막는다 */
export function Before() {
  return (
    <Phone>
      <Back close />
      <Say text="이미 드신 약이에요. 점심 약은 12시 31분에 찍었어요." />
      <Fig name="photo-palm-noon-2" left={105} width={180} />
      <Stop ink />
      <Verdict title="이미 드신 약이에요" tell="점심 12:31에 찍었어요" />
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

function CamHead({ tell, warn }: { tell: string; warn?: boolean }) {
  return (
    <>
      <Row center top={128}>
        <Icon name="sun" />
        <T s={32} k>
          점심 2알
        </T>
      </Row>
      <T k center top={176} c={warn ? C.sun : undefined}>
        {tell}
      </T>
    </>
  );
}

/** p06 인증 촬영 */
export function Shoot() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <Say text="점심 약 두 알. 봉투는 위에, 약은 손바닥에 놓고 찍어 주세요." />
      <CamHead tell="봉투는 위에, 약은 손바닥에" />
      <Viewfinder guide photo="photo-palm-noon-2" />
      <Shutter onPress={() => go('p18-checking')} />
    </Phone>
  );
}

/** p06b 찍기 전 밝기 부족 */
export function ShootDark() {
  return (
    <Phone bg={C.cam} fg={C.white}>
      <Back close />
      <Say text="어두워요. 불을 켜 주세요." />
      <CamHead warn tell="불을 켜 주세요" />
      <Viewfinder dark photo="photo-palm-noon-2" />
      <Tap accessibilityLabel="손전등" style={[abs({ left: 28, top: 704, width: 64, height: 64 }), { borderRadius: 32, alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name="flashlight" size={40} c={C.sun} />
      </Tap>
      <Shutter onPress={() => go('p18-checking')} />
    </Phone>
  );
}

/** p18 보는 중. 판정은 서버 규칙, 8초를 넘으면 p15t */
export function Checking() {
  useEffect(() => {
    const t = setTimeout(() => swap('p07-ok'), 1800);
    return () => clearTimeout(t);
  }, []);
  return (
    <Phone>
      <Back close />
      <Ring photo="photo-palm-noon-2" title="보는 중" />
    </Phone>
  );
}

/* ── 판정 5종 (OK = 회차 완료) ── */
/** p07 OK */
export function Ok() {
  return (
    <Phone bg={C.ok} fg={C.white}>
      <Say text="맞아요, 드세요. 점심 약 완료. 다음은 저녁 식후예요." />
      <Fig name="verdict-ok" left={75} top={152} width={240} height={200} />
      <Verdict title="맞아요, 드세요" tell="점심 12:31 완료" line="다음은 저녁 식후" lineIcon="moon" />
      <Btn kind="w" label="확인" onPress={() => swap('p19-wait')} />
    </Phone>
  );
}

/** p08 WRONG_TIME */
export function WrongTime() {
  return (
    <Phone>
      <Back close />
      <Say text="저녁 약이에요. 봉투에 다시 넣어 주세요. 보호자에게 알렸어요." />
      <Fig name="verdict-wrong-time" />
      <Stop />
      <Verdict title="저녁 약이에요" tell="봉투에 다시 넣어요" line="보호자에게 알렸어요" lineIcon="bell" />
      <Btn two icon="camera" label="점심 봉투 찍기" onPress={shoot} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p09 ALREADY_TAKEN */
export function Already() {
  return (
    <Phone>
      <Back close />
      <Say text="이미 드셨어요. 봉투에 다시 넣어 주세요. 보호자에게 알렸어요." />
      <Fig name="verdict-already" />
      <Stop />
      <Verdict title="이미 드셨어요" tell="봉투에 다시 넣어요" line="보호자에게 알렸어요" lineIcon="bell" />
      <Btn two label="확인" onPress={() => swap('p19-wait')} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p10 COUNT_MISMATCH. 개수만 비교한다 */
export function Count() {
  return (
    <Phone>
      <Back close />
      <Say text="한 알이 모자라요. 두 알인지 다시 세어 보세요. 보호자에게 알렸어요." />
      <Fig name="verdict-count" width={270} height={200} />
      <Stop />
      <T k center top={340}>
        사진 1알 / 예상 2알
      </T>
      <Verdict title="1알이 모자라요" tell="2알인지 다시 세어 봐요" line="보호자에게 알렸어요" lineIcon="bell" />
      <Btn two icon="camera" label="다시 찍기" onPress={shoot} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p11 RETAKE. 회차 상태는 그대로, 보호자 알림 없음 */
export function Retake() {
  return (
    <Phone>
      <Back close />
      <Say text="다시 찍어 주세요. 폰을 식탁에 대고 찍으면 잘 찍혀요." />
      <Fig name="verdict-retake" />
      <Stop ink />
      <Verdict title="다시 찍어 주세요" tell="폰을 식탁에 대고 찍어요" />
      <Btn two icon="camera" label="다시 찍기" onPress={shoot} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/* ── 실패 · 연결 없음 ── */
/** p13 등록 추출 실패 */
export function NoRead() {
  return (
    <Phone>
      <Back close />
      <Say text="글씨가 안 보여요. 봉투를 펴서 다시 찍어 주세요." />
      <Fig name="envelope" />
      <Badge icon="eye" />
      <Verdict title="글씨가 안 보여요" tell="봉투를 펴서 다시 찍어요" />
      <Btn two icon="camera" label="다시 찍기" onPress={() => swap('p01-scan')} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p22 '모르겠어요' 뒤 */
export function Unsure() {
  return (
    <Phone>
      <Back />
      <Say text="보호자와 같이 봐요. 보호자에게 전화해 주세요. 보호자 폰으로 찍어도 돼요." />
      <Fig name="envelope" />
      <Badge icon="circle-help" />
      <Verdict title="보호자와 같이 봐요" tell="보호자에게 전화해요" line="보호자 폰으로 찍어도 돼요" />
      <Btn two icon="phone" label="전화" onPress={call} />
      <Sub icon="camera" label="다시 찍기" onPress={() => swap('p01-scan')} />
    </Phone>
  );
}

/** p15 연결 없음. 판정이 없으면 먹으라고 하지 않는다 */
export function Offline() {
  return (
    <Phone>
      <Back close />
      <Say text="인터넷이 안 돼요. 약은 봉투에 두고 잠깐 뒤 다시 찍어 주세요." />
      <Fig name="pouch-noon" />
      <Badge icon="wifi-off" />
      <Verdict title="인터넷이 안 돼요" tell={'약은 봉투에 두고\n잠깐 뒤 다시 찍어요'} />
      <Btn two icon="refresh-cw" label="다시 해 보기" onPress={() => swap('p06-shoot')} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p15t 서버 응답이 8초를 넘을 때 */
export function Slow() {
  return (
    <Phone>
      <Back close />
      <Say text="오래 걸려요. 약은 봉투에 두고 기다려 주세요. 조금 뒤 다시 해 보세요." />
      <Fig name="phone-shoot" />
      <Badge icon="clock" />
      <Verdict title="오래 걸려요" tell="약은 봉투에 두고 기다려요" line="조금 뒤 다시 해 봐요" />
      <Btn two icon="refresh-cw" label="다시 해 보기" onPress={() => swap('p06-shoot')} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}

/** p14 카메라 권한 거절. 켜기 = 앱 설정 열기 */
export function NoCam() {
  return (
    <Phone>
      <Back close />
      <Say text="카메라가 꺼졌어요. 켜야 찍을 수 있어요." />
      <Fig name="phone-shoot" />
      <Badge icon="camera-off" />
      <Verdict title="카메라가 꺼졌어요" tell="켜야 찍을 수 있어요" />
      <Btn two icon="settings" label="켜기" onPress={() => Linking.openSettings().catch(() => {})} />
      <Sub icon="phone" label="보호자에게 전화" onPress={call} />
    </Phone>
  );
}
