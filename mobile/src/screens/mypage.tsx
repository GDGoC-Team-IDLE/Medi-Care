// 보호자 마이페이지: 어르신 등록(→ 연결 숫자) · 어르신 관리(→ 어르신 고르기 → 달력)
// 목업에 없는 화면이라 계정 화면(c01·c03) 틀을 그대로 쓴다: 제목 132 · 설명 186 · 내용 244~ · 아래 버튼 730.
// 상자(카드) 없이 줄 목록으로: 묶음 제목 하나 + 아이콘 · 제목 · 짧은 설명 · > (iOS 설정·Android 설정 지침의 묶음 목록).
// 어르신은 번호(1·2·3…)로 구분하고 줄 사이엔 가는 선만 둔다. 이름이 길면 줄을 바꾸지 않고 글자만 줄인다.
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { go, swap } from '@/lib/nav';
import { api, ApiError } from '@/lib/api';
import { C, R } from '@/constants/theme';
import { Icon, Phone, T, Tap, abs, type IconName } from '@/components/core';
import { Field } from '@/components/field';
import { Back, Btn } from '@/components/parts';

export type PatientItem = { patient_id: number; name: string; paired: boolean };

/** 서버 오류를 한 줄로 */
function failText(x: unknown, what: string) {
  const status = x instanceof ApiError ? x.status : -1;
  if (status === 401) return '보호자 로그인부터 해 주세요';
  if (status === 0) return '서버에 연결하지 못했어요';
  return `${what} 다시 해 주세요`;
}

/** 방금 받은 연결 숫자. 주소(?code=)에 넣으면 웹 방문 기록에 남아서 앱 메모리로만 g04 에 넘긴다 */
export type Issued = { code: string; name: string; patient_id: number };
let issued: Issued | null = null;
export const getIssued = () => issued;

/** 새 연결 숫자를 받아 g04 로 갈 주소를 돌려준다. 숫자는 5분 동안 쓸 수 있고, 새로 받으면 앞 숫자는 못 쓴다 */
export async function issueCode(p: Pick<PatientItem, 'patient_id' | 'name'>) {
  const { pairing_code } = await api.post<{ pairing_code: string; expires_in_seconds: number }>(`/patients/${p.patient_id}/pairing-code`);
  issued = { code: pairing_code, name: p.name, patient_id: p.patient_id };
  return 'g04-code?issued=1';
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
/** 줄 사이 가는 선 */
const Line = () => <View style={{ height: 1, backgroundColor: C.line }} />;

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
        <Row icon="users" title="어르신 관리" note="골라서 달력을 봐요" onPress={() => go('g22-patients')} />
        <Line />
        <Row icon="plus" title="어르신 등록" note="연결 숫자를 받아요" onPress={() => go('g21-addpatient')} />
      </View>
    </Phone>
  );
}

/** g21 어르신 등록. POST /patients → POST /patients/{id}/pairing-code → g04 연결 숫자(어르신 폰 c06 에 넣는다) */
export function AddPatient() {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string>();
  const busy = useRef(false);
  const made = useRef<PatientItem | null>(null); // 숫자 받기에서 실패해 다시 눌러도 어르신을 두 번 만들지 않게
  const submit = async () => {
    const n = name.trim();
    if (!n) return setErr('부를 이름을 넣어 주세요');
    if (busy.current) return;
    busy.current = true;
    try {
      if (!made.current || made.current.name !== n) {
        const r = await api.post<{ patient_id: number; name: string }>('/patients', { name: n });
        made.current = { patient_id: r.patient_id, name: r.name, paired: false };
      }
      swap(await issueCode(made.current));
    } catch (x) {
      setErr(failText(x, '등록하지 못했어요.'));
    } finally {
      busy.current = false;
    }
  };
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        어르신 등록
      </T>
      <T s={20} c={C.ink2} left={28} right={28} top={186}>
        어르신 화면에 이 이름으로 보여요
      </T>
      <Field
        label="부를 이름"
        top={256}
        value={name}
        error={err}
        onChangeText={(v) => {
          setName(v);
          setErr(undefined);
        }}
        placeholder="어머니"
        autoFocus
        maxLength={10}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {/* 자판 위에 붙는 자리 (c03 과 같다) */}
      <Btn top={418} label="연결 숫자 받기" onPress={() => void submit()} />
    </Phone>
  );
}

/** g22 어르신 고르기. GET /patients (만든 순서) → 고르면 그 어르신의 c08 달력. 연결 전이면 연결 숫자를 다시 받을 수 있다 */
export function Patients() {
  const [list, setList] = useState<PatientItem[] | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState<number | null>(null);
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
  const code = async (p: PatientItem) => {
    if (busy != null) return;
    setBusy(p.patient_id);
    try {
      go(await issueCode(p));
    } catch (x) {
      setErr(failText(x, '연결 숫자를 못 받았어요.'));
    } finally {
      setBusy(null);
    }
  };
  const empty = list?.length === 0;
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        어느 어르신인가요?
      </T>
      <T s={20} k={!!err} c={err ? C.wrong : C.ink2} left={28} right={28} top={186}>
        {err ?? (empty ? '등록한 어르신이 없어요' : list ? `${list.length}명 · 고르면 달력을 봐요` : '불러오는 중이에요')}
      </T>
      <ScrollView style={abs({ left: 0, right: 0, top: 236, height: 478 })} contentContainerStyle={{ paddingHorizontal: 28 }}>
        {list?.map((p, i) => (
          <View key={p.patient_id}>
            {i > 0 && <Line />}
            <View style={{ height: 88, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Tap
                accessibilityRole="button"
                accessibilityLabel={`${i + 1}번 ${p.name}, ${p.paired ? '연결됨' : '어르신 폰 연결 전'}, 달력 보기`}
                onPress={() => go(`c08-calendar?patient_id=${p.patient_id}&name=${encodeURIComponent(p.name)}`)}
                style={{ flex: 1, height: 88, flexDirection: 'row', alignItems: 'center', gap: 16 }}
              >
                {/* 몇 번 어르신인지: 만든 순서 번호 */}
                <T s={32} k num style={{ width: 32, textAlign: 'center' }}>
                  {i + 1}
                </T>
                <View style={{ flex: 1 }}>
                  {/* 이름은 최대 10자. 남는 폭(연결 숫자 단추 자리 빼고 약 170)에 맞춰 한 줄로 줄인다 */}
                  <T s={20} k fit={170}>
                    {p.name}
                  </T>
                  <T s={16} c={p.paired ? C.ink2 : C.wrong}>
                    {p.paired ? '연결됨' : '어르신 폰 연결 전'}
                  </T>
                </View>
                {p.paired && <Icon name="chevron-right" size={24} c={C.ink2} />}
              </Tap>
              {!p.paired && (
                <Tap accessibilityLabel={`${p.name} 연결 숫자 받기`} onPress={() => void code(p)} style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="link" size={20} />
                  <T s={16} k>
                    {busy === p.patient_id ? '받는 중' : '연결 숫자'}
                  </T>
                </Tap>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
      <Tap
        onPress={() => go('g21-addpatient')}
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
