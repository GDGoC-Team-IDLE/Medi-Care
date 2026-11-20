import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, sizes, spacing } from '@/constants/theme';

/** 자리표시 화면 — B 담당이 실제 화면으로 바꿉니다. */
export default function GuardianHome() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>보호자 홈 — B 담당</Text>
      <Text style={styles.body}>src/app/guardian/index.tsx</Text>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      >
        <Text style={styles.buttonText}>처음 화면으로</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.title, fontWeight: '700', color: colors.text, textAlign: 'center' },
  body: { fontSize: fontSize.body, color: colors.textMuted, textAlign: 'center' },
  button: {
    minHeight: sizes.buttonHeight,
    borderRadius: sizes.radius,
    borderWidth: 2,
    borderColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  buttonText: { color: colors.secondary, fontSize: fontSize.button, fontWeight: '700' },
});
