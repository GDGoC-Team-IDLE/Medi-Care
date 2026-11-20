// 계정 (보호자 이메일 로그인 → "어르신 폰으로 쓰기") · 연결 숫자(별안)
import { useRef, useState } from 'react';
import { Share, View, type TextInputInstance } from 'react-native';
import { go, swap, back } from '@/lib/nav';
import { api, ApiError, clearToken, saveToken } from '@/lib/api';
import { LINK_CODE } from '@/lib/mock';
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
      go('c02-device');
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
      go('c02-device');
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
      <Btn two label="어르신 폰으로 쓰기" onPress={() => go('c03-patient')} />
      {/* 처음 로그인한 보호자 폰: 복용 기록이 있는 현황이 아니라 약이 아직 없는 현황으로 */}
      <Sub label="내 폰으로 쓰기" onPress={() => swap('g08-empty')} />
    </Phone>
  );
}

/** c03 어르신 이름. POST /patients → pairing-code → /devices/pair → 이 폰엔 X-Device-Token 만 저장 */
export function Patient() {
  const [name, setName] = useState('어머니');
  const [err, setErr] = useState<string>();
  const busy = useRef(false);
  const pid = useRef<number | null>(null); // 중간에 실패해 다시 눌러도 어르신을 두 번 만들지 않게
  const submit = async () => {
    if (!name.trim()) return setErr('부를 이름을 넣어 주세요');
    if (busy.current) return;
    busy.current = true;
    try {
      pid.current ??= (await api.post<{ patient_id: number }>('/patients', { name: name.trim() })).patient_id;
      const { pairing_code } = await api.post<{ pairing_code: string }>(`/patients/${pid.current}/pairing-code`);
      const { device_token } = await api.post<{ device_token: string }>('/devices/pair', { code: pairing_code });
      await saveToken('device', device_token);
      await Promise.all([clearToken('guardian'), clearToken('guardianRefresh')]); // 이 폰엔 보호자 로그인을 남기지 않는다
      go('c04-linked');
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 401 ? '보호자 로그인부터 해 주세요' : '연결하지 못했어요. 다시 눌러 주세요');
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

/** c04 연결됐어요. 보호자 로그인 정보는 이 폰에 남지 않는다 */
export function Linked() {
  return (
    <Phone>
      {/* 두 폰이 서로 향해 돌아 들어오고, 어르신 폰이 울리며 알약이 톡톡 → 연결 배지 */}
      <Phone3D left={55} top={172} ry={34} sw={-18} enter="l" />
      <Phone3D left={175} top={172} ry={-34} r0={75} sw={18} pills ring enter="r" />
      <Badge icon="link" top={172} delay={0.6} />
      <Verdict mv={false} title="연결됐어요" tell="앱을 열면 바로 약 화면이에요" line="보호자 로그인은 남지 않아요" />
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

/** g04 연결 숫자 (보호자 폰) */
export function Code() {
  const shown = `${LINK_CODE.slice(0, 3)} ${LINK_CODE.slice(3)}`;
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        연결 숫자
      </T>
      <T s={20} c={C.ink2} left={28} right={28} top={186}>
        어르신 폰에 이 숫자를 넣어요
      </T>
      <T s={56} num left={28} top={260} style={{ letterSpacing: 0.04 * 56 }}>
        {shown}
      </T>
      <Tap
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
      <Btn two label="다시 넣기" onPress={back} />
      <Sub icon="refresh-cw" label="새 숫자 받기" onPress={back} />
    </Phone>
  );
}
