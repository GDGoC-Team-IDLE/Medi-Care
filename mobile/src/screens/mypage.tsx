// 보호자 마이페이지: 어르신 등록(c03 이름 → g04 연결 숫자) · 어르신 관리(g22 어르신 고르기 → c08 달력)
// 목업에 없는 화면이라 계정 화면(c01·c03) 틀을 그대로 쓴다: 제목 132 · 설명 186 · 내용 244~ · 아래 버튼 730.
// 상자 · 테두리 · 구분선 없이 자리(들여쓰기 · 간격)로만 묶는다: 묶음 제목 하나 + 아이콘 · 제목 · 짧은 설명 · >.
// 어르신은 번호(1·2·3…)로 구분하고 어르신 사이는 간격으로 띄운다. 이름이 길면 줄을 바꾸지 않고 글자만 줄인다.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { go, swap } from '@/lib/nav';
import { setCurrentPatient, useCurrentPatient } from '@/lib/currentPatient';
import { api, ApiError } from '@/lib/api';
import { C, R } from '@/constants/theme';
import { Icon, Phone, T, Tap, abs, type IconName } from '@/components/core';
import { Back } from '@/components/parts';
import { openCode } from './account';

export type PatientItem = { patient_id: number; name: string; paired: boolean };

/** 서버 오류를 한 줄로 */
function failText(x: unknown, what: string) {
  const status = x instanceof ApiError ? x.status : -1;
  if (status === 401) return '보호자 로그인부터 해 주세요';
  if (status === 0) return '서버에 연결하지 못했어요';
  return `${what} 다시 해 주세요`;
}

/** 목록 한 줄(상자 없음): 아이콘 · 제목 · 짧은 설명 · > */
function Row({ icon, title, note, onPress }: { icon: IconName; title: string; note: string; onPress: () => void }) {
  return (
    <Tap accessibilityRole="button" accessibilityLabel={`${title}, ${note}`} onPress={onPress} style={{ height: 80, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Icon name={icon} size={28} />
      <View style={{ flex: 1 }}>
        <T s={20} k>
          {title}
        </T>
        <T s={16} c={C.ink2}>
          {note}
        </T>
      </View>
      <Icon name="chevron-right" size={24} c={C.ink2} />
    </Tap>
  );
}

/** g20 마이페이지 (보호자). g01 현황 머리줄의 사람 아이콘으로 들어온다 */
export function MyPage() {
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        마이페이지
      </T>
      <T s={20} c={C.ink2} left={28} right={28} top={186}>
        어르신을 등록하고 기록을 봐요
      </T>
      <View style={abs({ left: 28, right: 28, top: 244 })}>
        <T s={16} k c={C.ink2}>
          어르신
        </T>
        <Row icon="users" title="어르신 관리" note="선택하고 달력을 봐요" onPress={() => go('g22-patients')} />
        <Row icon="plus" title="어르신 등록" note="연결 숫자를 받아요" onPress={() => go('c03-patient')} />
      </View>
    </Phone>
  );
}

/** 어르신 줄의 버튼: 면 · 테두리 없이 아이콘 + 굵은 글자. 누를 자리는 높이 48 로 넉넉히, 버튼 사이는 간격으로 구분 */
function Action({ icon, label, a11y, onPress, selected }: { icon: IconName; label: string; a11y: string; onPress: () => void; selected?: boolean }) {
  const c = selected ? C.ok : C.ink;
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: !!selected }}
      disabled={selected}
      onPress={onPress}
      style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Icon name={icon} size={24} c={c} />
      <T s={20} k c={c}>
        {label}
      </T>
    </Tap>
  );
}

/**
 * g22 어르신 고르기. GET /patients (만든 순서). 어르신마다 버튼:
 * - 달력: 그 어르신의 c08 달력
 * - 선택: 보호자 폰이 지금 볼 어르신으로 정하고 보호자 홈으로(머리줄 이름 · 달력 · 약봉투 등록이 이 어르신). 고른 어르신은 '선택됨'
 * - 연결 숫자: 어르신 폰 연결 전이면 새 숫자(g04)
 */
export function Patients() {
  const [list, setList] = useState<PatientItem[] | null>(null);
  const [err, setErr] = useState<string>();
  useFocusEffect(
    useCallback(() => {
      let live = true;
      api
        .get<{ patients: PatientItem[] }>('/patients')
        .then((r) => live && (setList(r.patients), setErr(undefined)))
        .catch((x) => live && setErr(failText(x, '목록을 못 불러왔어요.')));
      return () => {
        live = false;
      };
    }, []),
  );
  // 숫자는 g04 가 열 때 새로 받는다(5분, 앞 숫자는 못 씀)
  const code = (p: PatientItem) => go(openCode(p.patient_id, p.name));
  const cur = useCurrentPatient();
  const pick = async (p: PatientItem) => {
    await setCurrentPatient({ patient_id: p.patient_id, name: p.name });
    swap('g08-empty'); // 보호자 홈 (로그인 뒤와 같은 곳)
  };
  const empty = list?.length === 0;
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        어느 어르신인가요?
      </T>
      <T s={20} k={!!err} c={err ? C.wrong : C.ink2} left={28} right={28} top={186}>
        {err ?? (empty ? '등록한 어르신이 없어요' : list ? `${list.length}명 · 선택한 어르신을 홈에서 봐요` : '불러오는 중이에요')}
      </T>
      <ScrollView style={abs({ left: 0, right: 0, top: 236, height: 478 })} contentContainerStyle={{ paddingHorizontal: 28 }}>
        {list?.map((p, i) => {
          const on = cur?.patient_id === p.patient_id;
          return (
            <View key={p.patient_id} style={{ marginTop: i > 0 ? 28 : 8 }}>
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  {/* 몇 번 어르신인지: 만든 순서 번호 */}
                  <T s={32} k num style={{ width: 32, textAlign: 'center' }}>
                    {i + 1}
                  </T>
                  <View style={{ flex: 1 }}>
                    {/* 이름은 최대 10자. 한 줄에 맞춰 글자만 줄인다 */}
                    <T s={20} k fit={270}>
                      {p.name}
                    </T>
                    <T s={16} c={p.paired ? C.ink2 : C.wrong}>
                      {p.paired ? '연결됨' : '어르신 폰 연결 전'}
                    </T>
                  </View>
                </View>
                {/* 이름 아래 같은 들여쓰기(번호 폭 48)에 버튼을 나란히: 줄 · 면 없이 자리로 묶는다 */}
                <View style={{ flexDirection: 'row', gap: 24, paddingLeft: 48 }}>
                  <Action icon={on ? 'check' : 'circle-check'} label={on ? '선택됨' : '선택'} a11y={on ? `${p.name} 선택됨` : `${i + 1}번 ${p.name} 선택`} selected={on} onPress={() => void pick(p)} />
                  <Action icon="calendar-days" label="달력" a11y={`${i + 1}번 ${p.name} 달력 보기`} onPress={() => go(`c08-calendar?patient_id=${p.patient_id}&name=${encodeURIComponent(p.name)}`)} />
                  {!p.paired && <Action icon="link" label="연결 숫자" a11y={`${p.name} 연결 숫자 받기`} onPress={() => code(p)} />}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Tap
        onPress={() => go('c03-patient')}
        style={[abs({ left: 28, right: 28, top: 730, height: 64 }), { borderRadius: R.m, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
      >
        <Icon name="plus" size={24} c={C.paper} />
        <T s={20} k c={C.paper}>
          어르신 등록
        </T>
      </Tap>
    </Phone>
  );
}
