import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, sizes, spacing } from '@/constants/theme';

/** 시작 화면: 복용자 / 보호자 화면으로 이동만 합니다. */
export default function StartScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Medi-Care</Text>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        onPress={() => router.push('/patient')}
      >
        <Text style={styles.buttonText}>복용자 화면</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
        onPress={() => router.push('/guardian')}
      >
        <Text style={styles.buttonText}>보호자 화면</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  button: {
    minHeight: sizes.buttonHeight,
    borderRadius: sizes.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: { color: colors.onPrimary, fontSize: fontSize.button, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
