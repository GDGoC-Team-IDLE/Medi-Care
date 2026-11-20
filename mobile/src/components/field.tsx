// 입력 칸: 이름표 · 옅은 면 · 초점 테두리 · 지우기/비밀번호 보기 · 오류 한 줄
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Animated, Easing, Platform, Pressable, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { C, R } from '@/constants/theme';
import { Icon, T, Tap, abs } from './core';

type FieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** 이름표의 top. 칸은 그 아래 32 에서 시작한다(높이 64) */
  top: number;
  /** 오류 문장. 있으면 이름표 자리에 빨갛게 보인다 */
  error?: string;
  /** 비밀번호: 가려 두고 눈 단추로 본다 */
  secret?: boolean;
  inputRef?: RefObject<TextInputInstance | null>;
};

export function Field({ label, top, error, secret, inputRef, value, onChangeText, onFocus, onBlur, ...rest }: FieldProps) {
  const local = useRef<TextInputInstance>(null);
  const own = inputRef ?? local;
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const [f] = useState(() => new Animated.Value(0));
  useEffect(() => {
    // 색 보간은 네이티브 드라이버를 쓸 수 없다
    Animated.timing(f, { toValue: focused ? 1 : 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [f, focused]);
  const filled = !!value;
  return (
    <>
      <T s={20} k={!!error || focused} c={error ? C.wrong : focused ? C.ink : C.ink2} left={28} right={28} top={top}>
        {error ?? label}
      </T>
      <Pressable accessible={false} onPress={() => own.current?.focus()} style={abs({ left: 28, right: 28, top: top + 32, height: 64 })}>
        <Animated.View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: R.s,
            borderWidth: 2,
            paddingLeft: 18,
            paddingRight: 6,
            borderColor: error ? C.wrong : f.interpolate({ inputRange: [0, 1], outputRange: [C.tint, C.ink] }),
            backgroundColor: f.interpolate({ inputRange: [0, 1], outputRange: [C.tint, C.white] }),
          }}
        >
          <TextInput
            ref={own}
            accessibilityLabel={label}
            allowFontScaling={false}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            selectionColor={C.ink}
            cursorColor={C.ink}
            placeholderTextColor={C.plan}
            underlineColorAndroid="transparent"
            secureTextEntry={secret && !shown}
            {...rest}
            value={value}
            onChangeText={onChangeText}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            style={[
              { flex: 1, minWidth: 0, height: 60, fontSize: 24, fontWeight: '600', color: C.ink, padding: 0, includeFontPadding: false },
              // 웹: 브라우저 기본 파란 테두리를 끈다(초점은 칸의 테두리가 보여 준다)
              Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
            ]}
          />
          {secret ? (
            <Tap accessibilityLabel={shown ? '비밀번호 가리기' : '비밀번호 보기'} accessibilityState={{ selected: shown }} onPress={() => setShown(!shown)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="eye" size={24} c={shown ? C.ink : C.plan} />
            </Tap>
          ) : (
            focused &&
            filled && (
              <Tap
                accessibilityLabel={`${label} 지우기`}
                // 웹에서는 누르는 순간 칸이 초점을 잃으므로 눌리는 즉시 지운다
                onPressIn={() => {
                  onChangeText?.('');
                  own.current?.focus();
                }}
                style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
              >
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.plan, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="x" size={16} c={C.white} />
                </View>
              </Tap>
            )
          )}
        </Animated.View>
      </Pressable>
    </>
  );
}
