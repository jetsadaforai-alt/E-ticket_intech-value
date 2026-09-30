import React, { useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { openShopConversation } from '../api/chat';
import { ErrorBanner } from '../components/ErrorBanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { useToast } from '../components/Toast';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

// Verifies through the backend (POST /v1/auth/otp/verify), which returns a ready-to-use
// access token — the same call serves both login and registration via `purpose`.

type Props = NativeStackScreenProps<RootStackParamList, 'Otp'>;

const RESEND_SECONDS = 180;

export default function OtpScreen({ route, navigation }: Props) {
  const { phone, purpose, devCode, name, email, returnTo } = route.params;
  const [code, setCode] = useState(devCode ?? '');
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const { loginWithToken, refreshMe } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ access_token: string }>('/v1/auth/otp/verify', {
        method: 'POST',
        body: { phone, code, purpose },
        auth: false,
      });
      await loginWithToken(data.access_token);

      // Coming from RegisterScreen (name is only set on that path) — save the profile
      // fields via the same PATCH /v1/me EditProfileScreen uses. Best-effort: the
      // account already exists at this point, so a failure here shouldn't block entry —
      // the user can fix name/email later from EditProfileScreen.
      if (name) {
        try {
          await apiRequest('/v1/me', { method: 'PATCH', body: { name, email: email ?? '' } });
          await refreshMe();
        } catch (err) {
          console.warn('Saving profile after register failed:', err);
        }
        // Toast, not Alert: the navigation.reset below runs straight away, and a
        // blocking popup opened at the same moment used to fight it.
        toast('สมัครสมาชิกสำเร็จ ยินดีต้อนรับเข้าสู่ E-ticket');
      }

      if (!returnTo) {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] }); // clear Login/Otp from back-stack
      } else if (returnTo.kind === 'register_event') {
        // Deliberately NOT auto-claiming here — lands back on the same event page with
        // the ticket still unclaimed, so the user taps "รับคูปอง" again themselves and
        // goes through EventDetailScreen's own confirm-claim / success-choice dialogs.
        navigation.reset({
          index: 1,
          routes: [{ name: 'Home' }, { name: 'EventDetail', params: { eventId: returnTo.eventId } }],
        });
      } else if (returnTo.kind === 'contact_shop') {
        try {
          const room = await openShopConversation(returnTo.shopId);
          navigation.reset({
            index: 1,
            routes: [{ name: 'Home' }, { name: 'ChatRoom', params: { conversationId: room.id, title: room.shop_name } }],
          });
        } catch {
          navigation.reset({
            index: 1,
            routes: [{ name: 'Home' }, { name: 'EventDetail', params: { eventId: returnTo.eventId } }],
          });
        }
      } else {
        // return_to
        navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: returnTo.screen }] });
      }
    } catch (err) {
      setError(errorMessageTh(err, 'ยืนยันรหัสไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setResending(true);
    try {
      const data = await apiRequest<{ message: string; devCode?: string }>('/v1/auth/otp/request', {
        method: 'POST',
        body: { phone, purpose },
        auth: false,
      });
      setCode(data.devCode ?? '');
      setSecondsLeft(RESEND_SECONDS);
      toast('ส่งรหัสใหม่แล้ว', 'info');
    } catch (err) {
      setError(errorMessageTh(err, 'ขอรหัสใหม่ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setResending(false);
    }
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.iconCircle}>
          <Ionicons name="chatbox-ellipses-outline" size={30} color={colors.primary} />
        </View>
        <Text style={styles.title}>กรอกรหัส OTP</Text>
        <Text style={styles.subtitle}>
          เราส่งรหัส 6 หลักไปที่เบอร์{'\n'}
          <Text style={styles.phone}>{phone}</Text>
        </Text>
        {devCode ? (
          <View style={styles.badge}>
            <Ionicons name="flask-outline" size={16} color={colors.warning} />
            <Text style={styles.badgeText}>โหมดทดสอบ — ไม่มีการส่ง SMS จริง กรอกรหัสให้อัตโนมัติไว้แล้ว</Text>
          </View>
        ) : null}
        <TextInput
          style={[styles.input, focused && styles.inputFocused, error ? styles.inputError : null]}
          placeholder="• • • • • •"
          placeholderTextColor="#9AA3A1"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          accessibilityLabel="รหัส OTP 6 หลัก"
          maxLength={6}
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/\D/g, ''));
            if (error) setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <ErrorBanner message={error} />
        <PrimaryButton title="ยืนยัน" onPress={onSubmit} loading={loading} disabled={code.length !== 6} style={styles.submitBtn} />

        <View style={styles.resendRow}>
          {secondsLeft > 0 ? (
            <View style={styles.timerPill} accessibilityLabel={`ขอรหัสใหม่ได้ใน ${mm} นาที ${ss} วินาที`}>
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <Text style={styles.timerText}>
                ขอรหัสใหม่ได้ใน <Text style={styles.timerDigits}>{mm}:{ss}</Text>
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onResend}
              disabled={resending}
              style={styles.resendBtn}
              accessibilityRole="button"
              accessibilityState={{ disabled: resending, busy: resending }}
            >
              {resending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={16} color={colors.primary} />
              )}
              <Text style={styles.resendText}>{resending ? 'กำลังส่ง...' : 'ส่งรหัสใหม่'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  title: { ...type.title, textAlign: 'center', color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.sm },
  phone: { ...type.bodyStrong, color: colors.text, letterSpacing: 0.5 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.sm, alignSelf: 'stretch',
  },
  badgeText: { ...type.captionStrong, color: colors.warning, flex: 1 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: 28, lineHeight: 40, fontWeight: '600', textAlign: 'center', letterSpacing: 10, color: colors.text,
    ...shadows.card,
  },
  inputFocused: {
    borderColor: colors.primary, borderWidth: 2,
    shadowColor: colors.primary, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 3,
  },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  submitBtn: { marginTop: spacing.xs },
  resendRow: { alignItems: 'center' },
  timerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surfaceLow, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, minHeight: touch.min,
  },
  timerText: { ...type.bodySmall, color: colors.textMuted },
  timerDigits: { fontWeight: '700', color: colors.text },
  resendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: touch.min, paddingHorizontal: spacing.lg, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  resendText: { ...type.label, color: colors.primary },
});
