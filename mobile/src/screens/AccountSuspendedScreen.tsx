import React from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { useMode } from '../context/ModeContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AccountSuspended'>;

// The only screen a suspended account can reach besides SupportList/SupportThread —
// RootNavigator swaps the entire stack to just these three the moment me.status is
// 'suspended', so this never competes with the normal Home/Wallet/etc. screens for a
// route the backend would reject anyway (middleware/auth.js: everything but /v1/me,
// /v1/support-tickets, and /v1/notifications answers 403 ACCOUNT_SUSPENDED).
export default function AccountSuspendedScreen({ navigation }: Props) {
  const { me, logout } = useAuth();
  const { setMode } = useMode();

  const onLogout = async () => {
    setMode('customer');
    await logout();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={[styles.iconCircle, { backgroundColor: colors.dangerBg }]}>
          <Ionicons name="lock-closed-outline" size={28} color={colors.danger} />
        </View>
        <Text style={styles.title}>บัญชีของคุณถูกระงับ</Text>
        <Text style={styles.bodyText}>
          บัญชีนี้ถูกระงับการใช้งานโดยผู้ดูแลระบบ ตั๋วที่คุณถืออยู่ถูกยกเลิกไปแล้ว
        </Text>

        {me?.suspended_reason && (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonTitle}>เหตุผล:</Text>
            <Text style={styles.reasonText}>{me.suspended_reason}</Text>
          </View>
        )}

        <PrimaryButton
          title="ติดต่อเจ้าหน้าที่"
          onPress={() => navigation.navigate('SupportList')}
          style={styles.fullWidthBtn}
        />
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>ออกจากระบบ</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.md, justifyContent: 'center', backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card,
    padding: spacing.lg, alignItems: 'center', gap: spacing.sm,
    ...shadows.card,
  },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  bodyText: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },
  reasonBox: {
    alignSelf: 'stretch', backgroundColor: colors.neutralBubble,
    borderRadius: radius.md, padding: spacing.md, gap: 4,
    borderLeftWidth: 4, borderLeftColor: colors.danger,
  },
  reasonTitle: { ...type.bodyStrong, color: colors.text },
  reasonText: { ...type.bodySmall, color: colors.textMuted },
  fullWidthBtn: { alignSelf: 'stretch', marginTop: spacing.xs },
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.sm, minHeight: touch.min, paddingHorizontal: spacing.md,
  },
  logoutText: { ...type.label, color: colors.danger },
});
