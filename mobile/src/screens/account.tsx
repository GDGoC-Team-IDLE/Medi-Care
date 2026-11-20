// 계정: 누가 쓸 폰인가요(c02) → 보호자 폰은 로그인 → 어르신 이름(c03) → 연결 숫자(g04) / 어르신 폰은 연결 숫자 넣기(c06)
import { useEffect, useRef, useState } from 'react';
import { Share, View, type TextInputInstance } from 'react-native';
import { go, swap, back } from '@/lib/nav';
import { api, ApiError, saveToken } from '@/lib/api';
import { C, R } from '@/constants/theme';
import { Icon, Phone, T, Tap, abs } from '@/components/core';
import { Field } from '@/components/field';
import { Back, Badge, Btn, Phone3D, PillNoti, Sub, Verdict } from '@/components/parts';
import { requestMedicationNotificationPermissions } from '@/lib/medicationNotifications';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 로그인·가입 실패를 칸 아래 글로 */
function loginError(x: unknown): { email?: string; pw?: string } {
  const status = x instanceof ApiError ? x.status : -1;
  if (status === 409) return { email: '이미 가입된 이메일이에요' };
  if (status === 422) return { email: '이메일을 다시 봐 주세요' };
  if (status === 401) return { pw: '이메일이나 비밀번호가 달라요' };
  if (status === 0) return { pw: '서버에 연결하지 못했어요' };
  return { pw: '잠시 뒤 다시 해 주세요' };
}

type PatientRow = { patient_id: number; paired: boolean };

/**
 * 보호자 로그인 뒤 갈 곳. 어르신 없음 → c03 이름 / 어르신 폰이 아직 연결 안 됨 → g04 연결 숫자 /
 * 복용 중인 처방 있음 → g01 현황 / 없음 → g08 약봉투 찍기 (어르신이 여러 명이면 첫 어르신 기준)
 */
async function guardianHome(): Promise<string> {
  const { patients } = await api.get<{ patients: PatientRow[] }>('/patients');
  if (!patients.length) return 'c03-patient';
  if (!patients.some((p) => p.paired)) return 'g04-code';
  const first = patients.find((p) => p.paired) ?? patients[0];
  const { prescriptions } = await api.get<{ prescriptions: unknown[] }>(`/patients/${first.patient_id}/prescriptions`);
  return prescriptions.length ? 'g01-today' : 'g08-empty';
}

/** c01 보호자 로그인. POST /api/v1/auth/login (가입은 c01s) */
export function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<{ email?: string; pw?: string }>({});
  const pwRef = useRef<TextInputInstance>(null);
  const busy = useRef(false);
  const submit = async () => {
    const e = { email: EMAIL.test(email.trim()) ? undefined : '이메일을 다시 봐 주세요', pw: pw.length >= 8 ? undefined : '비밀번호는 8자 이상이에요' };
    setErr(e);
    if (e.email || e.pw || busy.current) return;
    busy.current = true;
    const user_email = email.trim();
    try {
      const t = await api.post<{ access_token: string; refresh_token: string }>('/auth/login', { user_email, password: pw });
      await Promise.all([saveToken('guardian', t.access_token), saveToken('guardianRefresh', t.refresh_token)]);
      go(await guardianHome());
    } catch (x) {
      setErr(loginError(x));
    } finally {
      busy.current = false;
    }
  };
  return (
    <Phone>
      <T h left={28} top={132}>
        보호자 로그인
      </T>
      <T c={C.ink2} left={28} right={28} top={186}>
        부모님 약을 함께 챙겨요
      </T>
      <Field
        label="이메일"
        top={256}
        value={email}
        error={err.email}
        onChangeText={(v) => {
          setEmail(v);
          setErr({ ...err, email: undefined });
        }}
        placeholder="name@mail.com"
        keyboardType="email-address"
        inputMode="email"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => pwRef.current?.focus()}
      />
      <Field
        secret
        inputRef={pwRef}
        label="비밀번호"
        top={376}
        value={pw}
        error={err.pw}
        onChangeText={(v) => {
          setPw(v);
          setErr({ ...err, pw: undefined });
        }}
        placeholder="8자 이상"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Btn two label="로그인" onPress={() => void submit()} />
      <Sub label="가입하기" onPress={() => go('c01s-signup')} />
    </Phone>
  );
}

/**
 * c01s 보호자 가입. POST /api/v1/auth/signup (user_email · password 8~128자 · user_nickname 1~50자) → 이어서 로그인해 토큰을 저장하고 c02.
 * 목업에 따로 없는 화면이라 c01 틀(제목 · 설명 · 칸 120 간격 · 두 버튼)을 그대로 쓴다.
 * 이름은 어르신 화면에 보일 이름(예: "딸에게 알렸어요")이라 c03 처럼 '부를 이름'으로 묻는다.
 */
export function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<{ name?: string; email?: string; pw?: string }>({});
  const emailRef = useRef<TextInputInstance>(null);
  const pwRef = useRef<TextInputInstance>(null);
  const busy = useRef(false);
  const submit = async () => {
    const n = name.trim();
    const e = {
      name: !n ? '부를 이름을 넣어 주세요' : n.length > 50 ? '이름은 50자까지예요' : undefined,
      email: EMAIL.test(email.trim()) ? undefined : '이메일을 다시 봐 주세요',
      pw: pw.length < 8 ? '비밀번호는 8자 이상이에요' : pw.length > 128 ? '비밀번호는 128자까지예요' : undefined,
    };
    setErr(e);
    if (e.name || e.email || e.pw || busy.current) return;
    busy.current = true;
    const user_email = email.trim();
    try {
      await api.post('/auth/signup', { user_email, password: pw, user_nickname: n });
      const t = await api.post<{ access_token: string; refresh_token: string }>('/auth/login', { user_email, password: pw });
      await Promise.all([saveToken('guardian', t.access_token), saveToken('guardianRefresh', t.refresh_token)]);
      go('c03-patient'); // 막 가입한 보호자는 어르신이 없다
    } catch (x) {
      setErr(loginError(x));
    } finally {
      busy.current = false;
    }
  };
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        보호자 가입
      </T>
      <T c={C.ink2} left={28} right={28} top={186}>
        부모님 화면에 이 이름으로 보여요
      </T>
      <Field
        label="부를 이름"
        top={256}
        value={name}
        error={err.name}
        onChangeText={(v) => {
          setName(v);
          setErr({ ...err, name: undefined });
        }}
        placeholder="딸"
        maxLength={50}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <Field
        inputRef={emailRef}
        label="이메일"
        top={376}
        value={email}
        error={err.email}
        onChangeText={(v) => {
          setEmail(v);
          setErr({ ...err, email: undefined });
        }}
        placeholder="name@mail.com"
        keyboardType="email-address"
        inputMode="email"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => pwRef.current?.focus()}
      />
      <Field
        secret
        inputRef={pwRef}
        label="비밀번호"
        top={496}
        value={pw}
        error={err.pw}
        onChangeText={(v) => {
          setPw(v);
          setErr({ ...err, pw: undefined });
        }}
        placeholder="8자 이상"
        maxLength={128}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Btn two label="가입하기" onPress={() => void submit()} />
      <Sub label="로그인" onPress={back} />
    </Phone>
  );
}

/** c02 누가 쓸 폰인가요? */
export function Device() {
  return (
    <Phone>
      <Back />
      {/* 목업 3D 폰: 몸을 돌려 들어와 좌우로 천천히 흔들리며 둥실 */}
      <Phone3D left={115} top={172} ry={-30} sw={22} />
      <Verdict mv={false} title="누가 쓸 폰인가요?" />
      {/* 어르신 폰은 로그인 없이 보호자 폰에 뜬 연결 숫자만 넣는다 */}
      <Btn two label="어르신 폰으로 쓰기" onPress={() => go('c06-pad')} />
      {/* 보호자 폰은 로그인 → 어르신이 없으면 c03 이름 → g04 연결 숫자 */}
      <Sub label="내 폰으로 쓰기" onPress={() => go('c01-login')} />
    </Phone>
  );
}

/** c03 에서 만든 어르신(또는 마이페이지 g22 에서 고른 어르신). g04 가 이 어르신의 연결 숫자를 받는다 */
let newPatient: number | null = null;
/** g04 에 보일 어르신 이름 · ‹ 로 돌아갈 곳(마이페이지에서 왔으면 그 화면으로) */
let codeFor: { name?: string; backTo?: 'back' } = {};
/** 마이페이지 g22 에서 연결 전 어르신의 연결 숫자를 열 때. 숫자는 g04 가 새로 받는다(5분) */
export function openCode(patientId: number, name: string) {
  newPatient = patientId;
  codeFor = { name, backTo: 'back' };
  return 'g04-code';
}

/** c03 어르신 이름 (보호자 폰). POST /patients 로 어르신을 만들고 g04 연결 숫자로 */
export function Patient() {
  const [name, setName] = useState('어머니');
  const [err, setErr] = useState<string>();
  const busy = useRef(false);
  const pid = useRef<number | null>(null); // 다시 눌러도 어르신을 두 번 만들지 않게
  const submit = async () => {
    if (!name.trim()) return setErr('부를 이름을 넣어 주세요');
    if (busy.current) return;
    busy.current = true;
    try {
      pid.current ??= (await api.post<{ patient_id: number }>('/patients', { name: name.trim() })).patient_id;
      newPatient = pid.current;
      codeFor = { name: name.trim() };
      go('g04-code');
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 401 ? '보호자 로그인부터 해 주세요' : '만들지 못했어요. 다시 눌러 주세요');
    } finally {
      busy.current = false;
    }
  };
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        어르신 이름
      </T>
      <T c={C.ink2} left={28} right={28} top={186}>
        내 화면에 이렇게 보여요
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
        onSubmitEditing={submit}
      />
      {/* 자판 위에 붙는 자리 */}
      <Btn top={418} label="다음" onPress={submit} />
    </Phone>
  );
}

/** c04 연결됐어요 (어르신 폰). 로그인 없이 연결 숫자로 연결됐다 */
export function Linked() {
  return (
    <Phone>
      {/* 두 폰이 서로 향해 돌아 들어오고, 어르신 폰이 울리며 알약이 톡톡 → 연결 배지 */}
      <Phone3D left={55} top={172} ry={34} sw={-18} enter="l" />
      <Phone3D left={175} top={172} ry={-34} r0={75} sw={18} pills ring enter="r" />
      <Badge icon="link" top={172} delay={0.6} />
      <Verdict mv={false} title="연결됐어요" tell="앱을 열면 바로 약 화면이에요" line="약은 보호자가 등록해요" />
      <Btn label="다음" onPress={() => go('c05-notify')} />
    </Phone>
  );
}

/** c05 알림 켜기. 누르면 권한을 차례로 묻는다(알림 · 정확한 알람 · 전체 화면 알림) */
export function Notify() {
  const enable = async () => {
    const granted = await requestMedicationNotificationPermissions();
    swap(granted ? 'p21-empty' : 'p26-belloff');
  };
  return (
    <Phone>
      <Back />
      {/* 받게 될 알림 모양을 미리 보여 준다: 회색 판 없이 p17 카드 하나가 위에서 내려온다 */}
      <PillNoti preview when="지금" title="점심 2알" top={120} />
      <Verdict readAloud mv={false} title="알림을 켜 주세요" top={508} tell="약 드실 때 이렇게 알려요" tellTop={562} />
      <Btn icon="bell-ring" label="알림 켜기" onPress={() => void enable()} />
    </Phone>
  );
}

/**
 * g04 연결 숫자 (보호자 폰). 열 때마다 POST /patients/{id}/pairing-code 로 새 숫자(5분)를 받는다.
 * 어르신: c03 에서 만든 어르신, 없으면 연결 안 된 첫 어르신. 어르신 폰이 숫자를 넣으면 g08(약봉투 찍기)로 넘어간다.
 * 목업에 다음 버튼이 없어 ‹ 를 누르면 g08
 */
export function Code() {
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [waitFor, setWaitFor] = useState<number | null>(null); // 연결을 기다리는 어르신
  useEffect(() => {
    let live = true;
    (async () => {
      const { patients } = await api.get<{ patients: PatientRow[] }>('/patients');
      const row = patients.find((p) => p.patient_id === newPatient) ?? patients.find((p) => !p.paired) ?? patients[0];
      if (!row) return swap('c03-patient'); // 어르신이 없으면 이름부터
      const { pairing_code } = await api.post<{ pairing_code: string }>(`/patients/${row.patient_id}/pairing-code`);
      if (!live) return;
      setCode(pairing_code);
      if (!row.paired) setWaitFor(row.patient_id); // 이미 연결된 어르신(폰 바꾸기)은 기다리지 않는다
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  // 3초마다 확인해 어르신 폰이 연결되면(paired) 다음 단계로
  useEffect(() => {
    if (waitFor == null) return;
    const t = setInterval(() => {
      api
        .get<{ patients: PatientRow[] }>('/patients')
        .then(({ patients }) => {
          if (!patients.find((p) => p.patient_id === waitFor)?.paired) return;
          clearInterval(t);
          swap('g08-empty');
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [waitFor]);
  const shown = code ? `${code.slice(0, 3)} ${code.slice(3)}` : '··· ···';
  const [who] = useState(() => codeFor);
  return (
    <Phone>
      <Back onPress={() => (who.backTo === 'back' ? back() : swap('g08-empty'))} />
      <T h left={28} top={132}>
        연결 숫자
      </T>
      <T s={20} c={failed ? C.wrong : C.ink2} left={28} right={28} top={186}>
        {failed ? '숫자를 받지 못했어요. 다시 열어 주세요' : '어르신 폰에 이 숫자를 넣어요'}
      </T>
      <T s={56} num left={28} top={260} style={{ letterSpacing: 0.04 * 56 }}>
        {shown}
      </T>
      {code && (
        <>
          {/* 이름은 최대 10자: 한 줄에 맞춰 글자만 줄인다 */}
          {who.name && (
            <T s={20} k fit={334} left={28} right={28} top={348}>
              {who.name}
            </T>
          )}
          <T s={20} c={C.ink2} left={28} right={28} top={who.name ? 380 : 348}>
            5분 안에 넣어 주세요
          </T>
        </>
      )}
      <Tap
        disabled={!code}
        onPress={() => Share.share({ message: `약 알림 연결 숫자: ${shown}` }).catch(() => {})}
        style={[
          abs({ left: 28, right: 28, top: 730, height: 64 }),
          { borderRadius: R.m, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
        ]}
      >
        <Icon name="message-circle" size={24} c={C.paper} />
        <T s={20} k c={C.paper}>
          문자로 보내기
        </T>
      </Tap>
    </Phone>
  );
}

/** c06 연결 숫자 넣기 (어르신 폰). 6자리를 다 넣으면 바로 POST /devices/pair */
export function Pad() {
  const [code, setCode] = useState('');
  const pair = async (c: string) => {
    try {
      const { device_token } = await api.post<{ device_token: string }>('/devices/pair', { code: c });
      await saveToken('device', device_token);
      swap('c04-linked');
    } catch {
      setCode(''); // 틀림·만료·횟수 초과 → c07 에서 '다시 넣기'로 돌아오면 빈 칸부터
      go('c07-codebad');
    }
  };
  const press = (d: string) => {
    if (code.length >= 6) return;
    const next = code + d;
    setCode(next);
    if (next.length === 6) void pair(next);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        연결 숫자
      </T>
      <T c={C.ink2} left={28} right={28} top={186}>
        보호자 폰에 뜬 숫자를 넣어요
      </T>
      <View style={[abs({ left: 28, right: 28, top: 256 }), { flexDirection: 'row', justifyContent: 'space-between' }]}>
        {[0, 1, 2, -1, 3, 4, 5].map((i) =>
          i < 0 ? (
            <View key="gap" style={{ width: 4 }} />
          ) : (
            <View
              key={i}
              style={{
                width: 44,
                height: 84,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomWidth: i === code.length ? 8 : 4,
                borderBottomColor: i <= code.length ? C.ink : C.line,
              }}
            >
              <T s={56} k lh={1}>
                {code[i] ?? ''}
              </T>
            </View>
          ),
        )}
      </View>
      <View style={[abs({ left: 28, right: 28, top: 404 }), { flexDirection: 'row', flexWrap: 'wrap' }]}>
        {keys.map((k) => (
          <Tap
            key={k || 'none'}
            disabled={!k}
            accessibilityLabel={k === 'del' ? '지우기' : k}
            onPress={() => (k === 'del' ? setCode(code.slice(0, -1)) : press(k))}
            style={{ width: '33.333%', height: 96, alignItems: 'center', justifyContent: 'center' }}
          >
            {k === 'del' ? (
              <Icon name="delete" size={40} />
            ) : (
              <T s={32} k>
                {k}
              </T>
            )}
          </Tap>
        ))}
      </View>
    </Phone>
  );
}

/** c07 숫자가 달라요 (틀림·만료를 한 화면으로) */
export function CodeBad() {
  return (
    <Phone>
      <Back close />
      {/* 돌아 들어온 뒤 고개를 한 번 젓는다 */}
      <Phone3D left={115} top={172} ry={-22} kind="shake" />
      <Badge icon="x" top={172} />
      <Verdict mv={false} title="숫자가 달라요" tell="보호자 폰을 다시 봐 주세요" />
      {/* 새 숫자는 보호자 폰(g04)에서만 받을 수 있어서 어르신 폰엔 '새 숫자 받기'를 두지 않는다. 버튼이 하나라 기본 자리(696) */}
      <Btn label="다시 넣기" onPress={back} />
    </Phone>
  );
}
