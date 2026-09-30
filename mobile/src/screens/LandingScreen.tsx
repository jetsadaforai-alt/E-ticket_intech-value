import React from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../components/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, radius, spacing, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Landing'>;

/** LINE's own brand green — the button must look like LINE, not like our theme. */
const LINE_GREEN = '#06C755';

// Figma: "Landing Screen" () — entry point
// offering สมัครสมาชิก / เข้าสู่ระบบ / เข้าสู่ระบบด้วย LINE. LINE stays "เร็ว ๆ นี้" here,
// same as the placeholder already on LoginScreen — OAuth isn't implemented yet.
//
// Design pass 2026-08-22 ("ทันสมัย เน้นการตลาด น่ากดน่าใช้") — no custom fonts (project
// stays system-font, see theme.ts), so the hero leans on scale/weight contrast and a
// gradient mark instead: an eyebrow line states what the app *is* before the brand name
// says what it's *called*, and the logo gets real depth instead of a flat tint circle.
export default function LandingScreen({ navigation }: Props) {
  const onLinePress = () => {
    Alert.alert('เร็ว ๆ นี้', 'เข้าสู่ระบบด้วย LINE ยังไม่เปิดให้บริการ — ตอนนี้ใช้เบอร์โทรศัพท์ไปก่อนนะ');
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <LinearGradient
          colors={[colors.primary, colors.primaryDark]}
          start={{ x: 0.15, y: 0.1 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.logoBox}
        >
          <Ionicons name="ticket" size={44} color="#fff" />
        </LinearGradient>

        <Text style={styles.eyebrow}>คูปองส่วนลดร้านโปรดใกล้คุณ</Text>
        <Text style={styles.title}>E-ticket</Text>
        <Text style={styles.tagline}>
          ประตูสู่ทุกประสบการณ์ของคุณ จัดการตั๋วงานอีเวนต์ได้ง่าย ๆ ในที่เดียว
        </Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          title="สมัครสมาชิก"
          variant="secondary"
          onPress={() => navigation.navigate('Register')}
          style={styles.btn}
        />
        <PrimaryButton
          title="เข้าสู่ระบบ"
          onPress={() => navigation.navigate('Login')}
          style={styles.btn}
        />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>หรือ</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.lineButton}
          onPress={onLinePress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="เข้าสู่ระบบด้วย LINE (เร็ว ๆ นี้)"
        >
          <Ionicons name="chatbubble" size={18} color="#fff" />
          <Text style={styles.lineText}>เข้าสู่ระบบด้วย LINE</Text>
          <View style={styles.soonChip}>
            <Text style={styles.soonText}>เร็ว ๆ นี้</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: spacing.lg, backgroundColor: colors.background },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoBox: {
    width: 104, height: 104, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
    shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16,
    elevation: 8,
  },
  eyebrow: { ...type.label, color: colors.primary, letterSpacing: 0.4, marginBottom: spacing.xs },
  title: { fontSize: 34, lineHeight: 44, fontWeight: '700', textAlign: 'center', color: colors.text, marginBottom: spacing.sm, letterSpacing: -0.5 },
  tagline: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },
  actions: { paddingBottom: spacing.md },
  btn: { marginBottom: spacing.md },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...type.caption, marginHorizontal: spacing.md, color: colors.textMuted },
  lineButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: LINE_GREEN, borderRadius: radius.pill, minHeight: 52,
  },
  lineText: { ...type.button, color: '#fff' },
  soonChip: { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  soonText: { ...type.captionStrong, color: '#fff' },
});
