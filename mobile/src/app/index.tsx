// 화면 목록 (개발용 첫 화면). 서버·로그인 상태가 붙으면 여기서 /common/c01-login · /patient · /guardian 으로 갈라 보낸다.
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { go } from '@/lib/nav';
import { FLOWS } from '@/screens';
import { C } from '@/constants/theme';
import { Tap } from '@/components/core';

export default function Index() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <ScrollView contentContainerStyle={{ padding: 28, paddingBottom: 64, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Text style={{ fontSize: 40, fontWeight: '800', color: C.ink, letterSpacing: -1.2 }}>Medi-Care</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: C.ink2, marginTop: 4 }}>화면 {FLOWS.reduce((n, f) => n + f.screens.length, 0)}개 · 눌러서 열기</Text>
        <Tap onPress={() => go('c02-device')} style={{ marginTop: 24, height: 64, borderRadius: 20, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.paper }}>처음부터 시작</Text>
        </Tap>
        {FLOWS.map((f) => (
          <View key={f.name} style={{ marginTop: 32 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink2 }}>{f.name}</Text>
            {f.screens.map((s) => (
              <Tap key={s.id} onPress={() => go(s.id)} style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink, flex: 1 }}>{s.title}</Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.plan }}>{s.id}</Text>
              </Tap>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
