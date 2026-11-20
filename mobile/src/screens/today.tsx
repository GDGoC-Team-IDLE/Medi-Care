// 오늘 (허브) · 기록 ("오늘 약 먹었나요?" → 지난 날 목록 → 그날) · 기기 권한(알림 꺼짐) · 약 없음 뒤 허브
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Animated, AppState, Easing, Linking, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { back, go, swap } from '@/lib/nav';
import { api } from '@/lib/api';
import { isWeb } from '@/lib/platform';
import { elderHome } from '@/screens/account';
import { GUARDIAN, call } from '@/lib/mock';
import { C, R } from '@/constants/theme';
import { Icon, Ill, Phone, Pop, Row, StatusMark, T, Tap, Up, abs, reduceMotion, type IllName, type Status } from '@/components/core';
import { Fig3 } from '@/components/figure';
import { Back, Btn, Pills, Say, Sub, Tray } from '@/components/parts';

const told = `${GUARDIAN}에게 알렸어요`;
const callG = `${GUARDIAN}에게 전화하기`;

/** 허브 가운데 큰 낱말(56) 앞 상태 모양 + 아래 '딸에게 알렸어요' */
function HubState({ s, word, c }: { s: Status; word: string; c?: string }) {
  return (
    <>
      <Up delay={0.6}>
        <Row center top={356}>
          <StatusMark s={s} size={48} />
          <T s={56} k lh={1} c={c}>
            {word}
          </T>
        </Row>
      </Up>
      <Up delay={0.85}>
        <Row center top={428}>
          <Icon name="bell" size={24} c={C.ink2} />
          <T c={C.ink2}>{told}</T>
        </Row>
      </Up>
    </>
  );
}

/** 어르신 폰에 오늘 회차가 생겼는지 (GET /patients/me/dose-slots). 기기 토큰이 없거나 서버가 안 되면 false */
async function hasDoses() {
  try {
    const { slots } = await api.get<{ slots: unknown[] }>('/patients/me/dose-slots');
    return slots.length > 0;
  } catch {
    return false;
  }
}
/** 약을 기다리는 동안 다시 보는 간격 */
const RECHECK_MS = 15000;

/**
 * p21 등록된 약이 없을 때 (보호자와 연결한 직후 등).
 * 약은 보통 보호자가 등록하므로 주 버튼은 보호자에게 전화로 부탁하기, 보조는 어르신이 약봉투를 직접 찍기.
 * 화면이 떠 있는 동안 15초마다 · 앱으로 돌아올 때마다 오늘 회차를 다시 보고, 생기면 바로 p04 로 넘어간다.
 */
export function Empty() {
  useFocusEffect(
    useCallback(() => {
      let live = true;
      const check = async () => {
        if ((await hasDoses()) && live) swap('p04-today');
      };
      void check();
      const t = setInterval(() => void check(), RECHECK_MS);
      const sub = AppState.addEventListener('change', (st) => st === 'active' && void check());
      return () => {
        live = false;
        clearInterval(t);
        sub.remove();
      };
    }, []),
  );
  return (
    <Phone>
      <Say icon text={`아직 등록된 약이 없어요. ${GUARDIAN}에게 등록을 부탁해 주세요. 등록되면 바로 바뀌어요.`} />
      <Tray now={0.279} />
      <Fig3 name="envelope@132" motion="am-float" w={160} h={132} style={abs({ left: 115, top: 340 })} />
      <Up delay={0.6}>
        <T h center top={500}>
          약이 아직 없어요
        </T>
      </Up>
      <Up delay={0.7}>
        <Row center top={552}>
          {/* 15초마다 다시 보지만 아이콘은 그대로 둔다(깜빡이면 어르신이 헷갈린다) */}
          <Icon name="refresh-cw" size={24} c={C.ink2} />
          <T c={C.ink2}>등록되면 바로 바뀌어요</T>
        </Row>
      </Up>
      <Btn up={0.85} two icon="phone" label={`${GUARDIAN}에게 부탁하기`} onPress={call} />
      <Sub up={0.9} icon="camera" label="약봉투 직접 찍기" onPress={() => go('p01-scan')} />
    </Phone>
  );
}

/** p04 오늘: 지금 먹을 회차. 회차 상태는 약통 칸으로만 말한다 */
export function Today() {
  return (
    <Phone>
      <Say icon text="점심 약 드실 시간이에요. 식후 두 알. 드시기 전에 사진을 찍어 주세요." />
      <Tray slots={['done', 'plan', 'plan']} f={1} cur={1} now={0.443} />
      <Up delay={0.6}>
        <T s={84} num center top={360}>
          점심
        </T>
      </Up>
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn up={0.85} icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
    </Phone>
  );
}

/** p19 할 일이 없는 상태: 다음 회차를 회색으로 */
export function Wait() {
  return (
    <Phone>
      <Say icon text="점심 약은 드셨어요. 다음은 저녁 식후 세 알이에요." />
      <Tray slots={['done', 'done', 'plan']} f={2} now={0.62} />
      <Up delay={0.6}>
        <T s={32} k c={C.plan} center top={336}>
          다음
        </T>
      </Up>
      <Up delay={0.7}>
        <T s={84} num c={C.plan} center top={380}>
          저녁
        </T>
      </Up>
      <Pills pills={['pill-capsule', 'pill-round-blue', 'pill-scored']} count="3알" meal="식후" />
      <Btn up={0.85} kind="idle" label="오늘 먹은 약 보기" onPress={() => go('p27-didtake')} />
    </Phone>
  );
}

/** p20 미복용(15분 무응답 → 보호자 알림 뒤). 늦게 찍어 OK 면 완료로 바뀐다 */
export function Missed() {
  return (
    <Phone>
      <Say icon text={`점심 약 기록이 없어요. ${told}. 지금 드시려면 사진을 찍어 주세요.`} />
      <Tray slots={['done', 'missed', 'plan']} f={1} now={0.46} />
      <HubState s="missed" word="기록 없음" c={C.misst} />
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn up={0.85} two icon="camera" label="찍기" onPress={() => go('p06-shoot')} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p16 오복용(개수 다름). 다시 찍어 OK 면 완료로 바뀐다 */
export function Flagged() {
  return (
    <Phone>
      <Say icon text={`점심 약이 한 알 부족했어요. ${told}. 두 알을 놓고 다시 찍어 주세요.`} />
      <Tray slots={['done', 'wrong', 'plan']} f={1} now={0.45} />
      <HubState s="wrong" word="1알 부족" />
      <Pills pills={['pill-capsule', 'pill-slot-round']} miss={1} count="2알" meal="식후" />
      <Btn up={0.85} two icon="camera" label="다시 찍기" onPress={() => go('p06-shoot')} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/** p32b '약 없어요' 뒤 허브. 이 회차는 다시 알리지 않으니 '찍기'를 다시 내밀지 않는다 */
export function AfterNoMed() {
  return (
    <Phone>
      <Say icon text={`점심 약이 없어요. ${told}. 약을 찾으면 약 찾았어요를 눌러 주세요.`} />
      <Tray slots={['done', 'nomed', 'plan']} f={1} now={0.45} />
      <HubState s="missed" word="약 없음" />
      <Pills pills={['pill-capsule', 'pill-round-blue']} count="2알" meal="식후" />
      <Btn up={0.85} two icon="phone" label={callG} onPress={call} />
      <Sub up={0.9} icon="camera" label="약 찾았어요" onPress={() => go('p06-shoot')} />
    </Phone>
  );
}

const goElderHome = async () => swap(await elderHome());

/** p26 알림 권한이 꺼졌을 때. 설정에서 켜고 앱으로 돌아오면 다시 확인해 넘어간다. 웹은 알림이 없어 버튼이 바로 넘어간다 */
export function BellOff() {
  useEffect(() => {
    if (isWeb) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void Notifications.getPermissionsAsync().then(({ status }) => {
        if (status === 'granted') void goElderHome();
      });
    });
    return () => sub.remove();
  }, []);
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion()) return;
    const a = Animated.sequence([Animated.delay(400), Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.sin), useNativeDriver: false })]);
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Phone>
      <Say icon text="알림이 꺼져 있어요. 알림을 켜야 약 시간을 알려 드려요." />
      <Tray slots={['plan', 'plan', 'plan']} now={0.279} />
      <Row center top={336}>
        <Animated.View style={{ transform: [{ translateX: v.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1], outputRange: [0, -7, 7, -5, 5, -2, 0] }) }] }}>
          <Icon name="bell-off" size={80} />
        </Animated.View>
      </Row>
      <T s={32} k center top={436}>
        알림이 꺼져 있어요
      </T>
      <Btn up={0.85} two icon="bell-ring" label="알림 켜기" onPress={() => (isWeb ? void goElderHome() : void Linking.openSettings().catch(() => {}))} />
      <Sub up={0.9} icon="phone" label={callG} onPress={call} />
    </Phone>
  );
}

/* ── 기록 ── */
function TimeRow({ top, status, name, note, noteColor, photo, i = 0 }: { top: number; status: Status; name: string; note: string; noteColor?: string; photo?: IllName; i?: number }) {
  return (
    <View style={[abs({ left: 28, right: 28, top, height: 96 }), { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
      <Pop delay={250 + i * 90}>
        <StatusMark s={status} />
      </Pop>
      <View style={{ flex: 1 }}>
        <T s={32} k lh={1.1}>
          {name}
        </T>
        <T c={noteColor ?? C.ink2}>{note}</T>
      </View>
      {photo ? (
        <Tap accessibilityLabel={`${name} 사진`}>
          <View style={{ borderRadius: R.s, overflow: 'hidden' }}>
            <Ill name={photo} w={72} h={96} />
          </View>
        </Tap>
      ) : (
        <View style={{ width: 72 }} />
      )}
    </View>
  );
}

/** p27 오늘 약. GET /api/schedules/today. 열리면 바로 읽어 준다 */
export function DidTake() {
  return (
    <Phone>
      <Back />
      <Say text="아침 약은 8시 12분에, 점심 약은 12시 31분에 드셨어요. 저녁 약은 저녁 식후에 드세요." />
      <T h left={28} top={132}>
        오늘 약
      </T>
      <TimeRow top={228} status="done" name="아침" note="8:12 완료" photo="photo-palm-morning" />
      <TimeRow i={1} top={348} status="done" name="점심" note="12:31 완료" photo="photo-palm-noon-2" />
      <TimeRow i={2} top={468} status="planned" name="저녁" note="예정" noteColor={C.plan} />
      <Btn two label="확인" onPress={back} />
      <Sub icon="history" label="지난 기록 보기" onPress={() => go('p33-days')} />
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
        지난 기록
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
      <TimeRow top={228} status="done" name="아침" note="8:05 완료" photo="photo-palm-morning" />
      <TimeRow i={1} top={348} status="wrong" name="점심" note="12:40 1알 부족" photo="photo-palm-noon-1" />
      <TimeRow i={2} top={468} status="missed" name="저녁" note="기록 없음" noteColor={C.misst} />
      <Btn label="닫기" onPress={back} />
    </Phone>
  );
}
