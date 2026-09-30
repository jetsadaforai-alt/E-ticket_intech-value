import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { ClaimSuccessModal } from '../components/ClaimSuccessModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, radius, spacing, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ClaimTicket'>;

/**
 * Share codes are 24 hex characters (backend: randomBytes(12).toString('hex')). People
 * often paste the whole message a friend sent rather than just the code — pull the code
 * out of it so that still works. Anything else is sent as typed, same as before.
 */
function extractShareCode(input: string): string {
  const match = input.match(/\b[a-f0-9]{24}\b/i);
  return match ? match[0] : input.trim();
}

export default function ClaimTicketScreen({ navigation }: Props) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedTicketId, setClaimedTicketId] = useState<string | null>(null);

  const code = extractShareCode(token);
  const pastedMessage = token.trim() !== code && code.length === 24;

  const onClaim = async () => {
    setError(null);
    setLoading(true);
    try {
      const ticket = await apiRequest<{ id: string }>(`/v1/share/${code}/claim`, { method: 'POST' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setClaimedTicketId(ticket.id);
    } catch (err) {
      setError(errorMessageTh(err, 'รับตั๋วไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.iconCircle}>
          <Ionicons name="gift-outline" size={30} color={colors.primary} />
        </View>
        <Text style={styles.title}>รับตั๋วที่เพื่อนแชร์มา</Text>
        <Text style={styles.subtitle}>กรอกหรือวางรหัสที่เพื่อนส่งให้ (วางทั้งข้อความก็ได้)</Text>

        <View style={styles.rules}>
          <View style={styles.ruleRow}>
            <Ionicons name="time-outline" size={16} color={colors.textMuted} />
            <Text style={styles.ruleText}>รหัสแชร์ใช้ได้ภายใน 24 ชั่วโมงหลังเพื่อนกดแชร์</Text>
          </View>
          <View style={styles.ruleRow}>
            <Ionicons name="person-outline" size={16} color={colors.textMuted} />
            <Text style={styles.ruleText}>รับได้ 1 ใบต่อ Event และรหัสหนึ่งใช้ได้ครั้งเดียว</Text>
          </View>
        </View>

        <FormField
          label="รหัสแชร์"
          value={token}
          onChangeText={(v) => {
            setToken(v);
            if (error) setError(null);
          }}
          placeholder="เช่น 3f9a1c..."
          autoCapitalize="none"
          autoCorrect={false}
          helperText={pastedMessage ? `พบรหัส ${code}` : undefined}
          returnKeyType="done"
          onSubmitEditing={() => code && onClaim()}
        />

        <ErrorBanner message={error} />

        <PrimaryButton title="รับตั๋ว" icon="download-outline" onPress={onClaim} loading={loading} disabled={!code} />

        <ClaimSuccessModal
          visible={claimedTicketId !== null}
          onViewTicket={() => claimedTicketId && navigation.replace('TicketDetail', { ticketId: claimedTicketId })}
          onGoHome={() => navigation.replace('Home')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.md },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: spacing.sm,
  },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  subtitle: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.sm },
  rules: { backgroundColor: colors.surfaceLow, borderRadius: radius.md, padding: 12, gap: 6 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  ruleText: { ...type.bodySmall, color: colors.textMuted, flex: 1 },
});
