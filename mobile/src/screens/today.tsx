// 오늘 (허브) · 기록 ("오늘 약 먹었나요?" → 지난 날 목록 → 그날) · 기기 권한(알림 꺼짐)
import { Linking, View } from 'react-native';
import { back, go } from '@/lib/nav';
import { call } from '@/lib/mock';
import { C } from '@/constants/theme';
import { Icon, Ill, Phone, Row, StatusMark, T, Tap, abs, type IllName, type Status } from '@/components/core';
import { Arc, Back, Btn, Pills, Say, Sub } from '@/components/parts';

/** p21 등록된 약이 없을 때 */
export function Empty() {
  return (
    <Phone>
      <Say icon text="약봉투를 찍어서 약을 등록해 주세요." />
      <Arc now={0.279} />
      <Ill name="envelope" w={160} h={132} style={abs({ left: 115, top: 304 })} />
      <Btn icon="camera" label="약봉투 찍기" onPress={() => go('p01-scan')} />
    </Phone>
  );
}

/** p04 오늘: 지금 먹을 회차. 회차 상태는 호의 마디 모양으로만 말한다 */
export function Today() {
  return (
    <Phone>
      <Say icon text="점심 약 드실 시간이에요. 식후 두 알. 드시기 전에 사진을 찍어 주세요." />
      <Arc slots={['done', 'plan', 'plan']} big={1} focus={1} cur={1} now={0.443} />
      <T s={84} num center top={344}>
        점심
      </T>
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
    </Phone>
  );
}

/** p19 할 일이 없는 상태: 다음 회차를 회색으로 */
export function Wait() {
  return (
    <Phone>
      <Say icon text="점심 약은 드셨어요. 다음은 저녁 식후 세 알이에요." />
      <Arc slots={['done', 'done', 'plan']} focus={2} now={0.62} />
      <T s={32} k c={C.plan} center top={304}>
        다음
      </T>
      <T s={84} num c={C.plan} center top={344}>
        저녁
      </T>
      <Pills pills={['pill-capsule', 'pill-round-blue', 'pill-scored']} count="3알" meal="식후" />
      <Btn kind="idle" label="오늘 약 먹었나요?" onPress={() => go('p27-didtake')} />
    </Phone>
  );
}

/** p20 미복용(15분 무응답 → 보호자 알림 뒤). 늦게 찍어 OK 면 완료로 바뀐다 */
export function Missed() {
  return (
    <Phone>
      <Say icon text="점심 약 기록이 없어요. 보호자에게 알렸어요. 지금 드시려면 사진을 찍어 주세요." />
      <Arc slots={['done', 'missed', 'plan']} big={1} focus={1} now={0.46} />
      <Row center top={344}>
        <StatusMark s="missed" />
        <T s={56} k lh={1} c={C.misst}>
          기록 없음
        </T>
      </Row>
      <Row center top={416}>
        <Icon name="bell" size={24} c={C.ink2} />
        <T c={C.ink2} label="보호자에게 알렸어요">
          알렸어요
        </T>
      </Row>
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn two icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
      <Sub icon="phone" label="보호자 전화" onPress={call} />
    </Phone>
  );
}

/** p16 오복용(개수 다름). 다시 찍어 OK 면 완료로 바뀐다 */
export function Flagged() {
  return (
    <Phone>
      <Say icon text="점심 약이 한 알 부족했어요. 보호자에게 알렸어요. 두 알을 놓고 다시 찍어 주세요." />
      <Arc slots={['done', 'wrong', 'plan']} big={1} focus={1} now={0.45} />
      <Row center top={344}>
        <StatusMark s="wrong" />
        <T s={56} k lh={1}>
          1알 부족
        </T>
      </Row>
      <Row center top={416}>
        <Icon name="bell" size={24} c={C.ink2} />
        <T c={C.ink2} label="보호자에게 알렸어요">
          알렸어요
        </T>
      </Row>
      <Pills pills={['pill-capsule', 'pill-slot-round']} count="2알" meal="식후" />
      <Btn two icon="camera" label="다시 찍기" onPress={() => go('p06-shoot')} />
      <Sub icon="phone" label="보호자 전화" onPress={call} />
    </Phone>
  );
}

/** p26 알림 권한이 꺼졌을 때 */
export function BellOff() {
  return (
    <Phone>
      <Say icon text="알림이 꺼져 있어요. 알림을 켜야 약 시간을 알려 드려요." />
      <Arc slots={['plan', 'plan', 'plan']} now={0.279} />
      <Row center top={304}>
        <Icon name="bell-off" size={80} />
      </Row>
      <T s={32} k center top={400}>
        알림 꺼짐
      </T>
      <Btn two icon="bell-ring" label="알림 켜기" onPress={() => Linking.openSettings().catch(() => {})} />
      <Sub icon="phone" label="보호자 전화" onPress={call} />
    </Phone>
  );
}

/* ── 기록 ── */
function TimeRow({ top, status, name, note, noteColor, photo }: { top: number; status: Status; name: string; note: string; noteColor?: string; photo?: IllName }) {
  return (
    <View style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <StatusMark s={status} />
      <View style={{ flex: 1 }}>
        <T s={32} k lh={1.1}>
          {name}
        </T>
        <T c={noteColor ?? C.ink2}>{note}</T>
      </View>
      {photo ? (
        <Tap accessibilityLabel={`${name} 사진`}>
          <Ill name={photo} w={72} h={96} />
        </Tap>
      ) : (
        <View style={{ width: 72 }} />
      )}
    </View>
  );
}

/** p27 오늘 약. GET /api/schedules/today */
export function DidTake() {
  return (
    <Phone>
      <Back />
      <Say text="아침 약은 8시 12분에, 점심 약은 12시 31분에 드셨어요. 저녁 약은 저녁 식후에 드세요." />
      <T h left={28} top={132}>
        오늘 약
      </T>
      <TimeRow top={228} status="done" name="아침" note="8:12 먹음" photo="photo-palm-morning" />
      <TimeRow top={348} status="done" name="점심" note="12:31 먹음" photo="photo-palm-noon-2" />
      <TimeRow top={468} status="planned" name="저녁" note="예정" noteColor={C.plan} />
      <Btn two label="확인" onPress={back} />
      <Sub icon="history" label="지난 날" onPress={() => go('p33-days')} />
    </Phone>
  );
}

const PAST: [string, Status, Status, Status][] = [
  ['19일 목', 'done', 'wrong', 'missed'],
  ['18일 수', 'done', 'done', 'done'],
  ['17일 화', 'done', 'done', 'missed'],
  ['16일 월', 'done', 'done', 'done'],
  ['15일 일', 'done', 'wrong', 'done'],
  ['14일 토', 'done', 'done', 'done'],
];

/** p33 지난 날: 월 달력 대신 6일 목록. 모양 셋 = 아침·점심·저녁 */
export function PastDays() {
  return (
    <Phone>
      <Back />
      <Say text="지난 날 기록이에요. 날짜를 누르면 그날 사진을 볼 수 있어요." />
      <T h left={28} top={132}>
        지난 날
      </T>
      <View style={[abs({ left: 28, right: 28, top: 192 }), { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }]}>
        {(['sunrise', 'sun', 'moon'] as const).map((n) => (
          <View key={n} style={{ width: 40, alignItems: 'center' }}>
            <Icon name={n} size={24} c={C.ink2} />
          </View>
        ))}
      </View>
      {PAST.map(([day, a, b, c], i) => (
        <Tap key={day} onPress={() => go('c09-day')} style={[abs({ left: 28, right: 28, top: 228 + i * 68, height: 60 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
          <T k style={{ flex: 1 }}>
            {day}
          </T>
          <StatusMark s={a} size={40} />
          <StatusMark s={b} size={40} />
          <StatusMark s={c} size={40} />
        </Tap>
      ))}
      <Btn label="확인" onPress={back} />
    </Phone>
  );
}

/** c09 그날의 기록. 한 회차에 여러 장이면 마지막 판정 사진 한 장 */
export function Day() {
  return (
    <Phone>
      <Back />
      <Say text="19일 목요일. 아침은 드셨고, 점심은 한 알 부족했고, 저녁은 기록이 없어요." />
      <T h left={28} top={132}>
        19일 목요일
      </T>
      <TimeRow top={228} status="done" name="아침" note="8:05 먹음" photo="photo-palm-morning" />
      <TimeRow top={348} status="wrong" name="점심" note="12:40 1알 부족" photo="photo-palm-noon-1" />
      <TimeRow top={468} status="missed" name="저녁" note="기록 없음" noteColor={C.misst} />
      <Btn label="닫기" onPress={back} />
    </Phone>
  );
}
