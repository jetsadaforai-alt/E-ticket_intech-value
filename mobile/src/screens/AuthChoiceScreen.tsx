import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PendingAction, RootStackParamList } from '../navigation/RootNavigator';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, spacing, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AuthChoice'>;

// Reached only when a guest tries a gated action (register for a ticket, contact a
// shop, open chat) — never the app's cold-start entry (that's LandingScreen, which
// keeps its own direct navigate('Register')/navigate('Login') with no returnTo, and
// isn't routed through here). Keeping this screen light/context-specific rather than
// reusing Landing's full marketing hero, since the point here is "continue what you
// were doing", not a first impression.
function contextCopyFor(returnTo?: PendingAction): string {
  if (!returnTo) return 'เข้าสู่ระบบหรือสมัครสมาชิกเพื่อดำเนินการต่อ';
  switch (returnTo.kind) {
    case 'register_event':
      return 'เข้าสู่ระบบหรือสมัครสมาชิกเพื่อรับตั๋วนี้';
    case 'contact_shop':
      return 'เข้าสู่ระบบหรือสมัครสมาชิกเพื่อทักแชทร้านค้า';
    case 'return_to':
      return 'เข้าสู่ระบบหรือสมัครสมาชิกเพื่อดูแชทของคุณ';
  }
}

export default function AuthChoiceScreen({ route, navigation }: Props) {
  const returnTo = route.params?.returnTo;

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <LinearGradient
          colors={[colors.primary, colors.primaryDark]}
          start={{ x: 0.15, y: 0.1 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.logoBox}
        >
          <Ionicons name="ticket" size={36} color="#fff" />
        </LinearGradient>
        <Text style={styles.message}>{contextCopyFor(returnTo)}</Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          title="สมัครสมาชิก"
          variant="secondary"
          onPress={() => navigation.navigate('Register', { returnTo })}
          style={styles.btn}
        />
        <PrimaryButton
          title="เข้าสู่ระบบ"
          onPress={() => navigation.navigate('Login', { returnTo })}
          style={styles.btn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.lg, backgroundColor: colors.background },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  logoBox: {
    width: 88, height: 88, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
    shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16,
    elevation: 8,
  },
  message: { ...type.heading, color: colors.text, textAlign: 'center' },
  actions: { paddingBottom: spacing.md },
  btn: { marginBottom: spacing.md },
});
