// 계정 (보호자 이메일 로그인 → "이 폰을 어르신 폰으로 설정") · 연결 숫자(별안)
import { useRef, useState } from 'react';
import { Share, View, type TextInputInstance } from 'react-native';
import { go, swap, back } from '@/lib/nav';
import { LINK_CODE } from '@/lib/mock';
import { C } from '@/constants/theme';
import { Icon, Ill, Phone, T, Tap, abs } from '@/components/core';
import { Field } from '@/components/field';
import { Back, Badge, Btn, Sub, Verdict } from '@/components/parts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** c01 보호자 로그인. POST /api/auth/login (가입은 같은 칸 + /api/auth/signup) */
export function Login() {
  const [email, setEmail] = useState('minji@mail.com');
  const [pw, setPw] = useState('12345678');
  const [err, setErr] = useState<{ email?: string; pw?: string }>({});
  const pwRef = useRef<TextInputInstance>(null);
  const submit = () => {
    const e = { email: EMAIL.test(email.trim()) ? undefined : '이메일을 다시 봐 주세요', pw: pw.length >= 8 ? undefined : '비밀번호는 8자 이상이에요' };
    setErr(e);
    if (!e.email && !e.pw) go('c02-device');
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
        onSubmitEditing={submit}
      />
      <Btn two label="로그인" onPress={submit} />
      <Sub label="처음이에요 · 가입" onPress={submit} />
    </Phone>
  );
}

/** c02 누구 폰인가요? */
export function Device() {
  return (
    <Phone>
      <Back />
      <Ill name="phone" w={160} style={abs({ left: 115, top: 172 })} />
      <Verdict title="누구 폰인가요?" tell="어르신 폰이면 아래를 눌러요" />
      <Btn two label="어르신 폰으로 설정" onPress={() => go('c03-patient')} />
      {/* 처음 로그인한 보호자 폰: 복용 기록이 있는 현황이 아니라 약이 아직 없는 현황으로 */}
      <Sub label="내 폰으로 쓰기" onPress={() => swap('g08-empty')} />
    </Phone>
  );
}

/** c03 어르신 이름. POST /api/patients → 이 폰엔 X-Device-Token 만 저장 */
export function Patient() {
  const [name, setName] = useState('어머니');
  const [err, setErr] = useState<string>();
  const submit = () => (name.trim() ? go('c04-linked') : setErr('부를 이름을 넣어 주세요'));
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        어르신 이름
      </T>
      <T c={C.ink2} left={28} right={28} top={186}>
        보호자 화면에 이렇게 보여요
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
      <Btn top={418} label="설정 끝내기" onPress={submit} />
    </Phone>
  );
}

/** c04 연결됐어요. 보호자 로그인 정보는 이 폰에 남지 않는다 */
export function Linked() {
  return (
    <Phone>
      <View style={abs({ left: 75, top: 172, width: 240, height: 160 })}>
        <Ill name="phone" w={160} style={abs({ left: -4, top: 0 })} />
        <Ill name="phone-ring" w={160} style={abs({ left: 84, top: 0 })} />
      </View>
      <Badge icon="link" top={172} />
      <Verdict title="연결됐어요" tell="이제 바로 약 화면이 열려요" line="이 폰엔 로그인이 남지 않아요" />
      <Btn label="다음" onPress={() => go('c05-notify')} />
    </Phone>
  );
}

/** c05 알림 켜기. 누르면 권한을 차례로 묻는다(알림 · 정확한 알람 · 전체 화면 알림) */
export function Notify() {
  return (
    <Phone>
      <Back />
      <Ill name="phone-ring" w={160} style={abs({ left: 115, top: 172 })} />
      <Badge icon="bell-ring" top={172} />
      <Verdict title="알림 켜기" tell="약 먹을 때 소리로 알려요" />
      <Btn label="켜기" onPress={() => swap('p21-empty')} />
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
          { borderRadius: 32, backgroundColor: C.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
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

/** c06 연결 숫자 넣기 (어르신 폰). 6자리를 다 넣으면 바로 확인한다 */
export function Pad() {
  const [code, setCode] = useState('482');
  const press = (d: string) => {
    if (code.length >= 6) return;
    const next = code + d;
    setCode(next);
    if (next.length === 6) setTimeout(() => (next === LINK_CODE ? swap('c04-linked') : go('c07-codebad')), 250);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <Phone>
      <Back />
      <T h left={28} top={132}>
        연결 숫자
      </T>
      <T c={C.ink2} left={28} right={28} top={186}>
        보호자 폰의 숫자 6개
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
      <Ill name="phone" w={160} style={abs({ left: 115, top: 172 })} />
      <Badge icon="x" top={172} />
      <Verdict title="숫자가 달라요" tell="보호자 폰 숫자를 다시 봐요" />
      <Btn two label="다시 넣기" onPress={back} />
      <Sub icon="refresh-cw" label="새 숫자 받기" onPress={back} />
    </Phone>
  );
}
