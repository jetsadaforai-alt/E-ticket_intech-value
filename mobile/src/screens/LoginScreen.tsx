import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh, isApiError } from '../api/errorMessages';
import { ErrorBanner } from '../components/ErrorBanner';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, radius, spacing, type } from '../theme';

// OTP goes through the backend (POST /v1/auth/otp/request|verify — backend/src/routes/auth.js,
// Redis-backed). Outside production the response carries `devCode` so testing needs no SMS.

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation, route }: Props) {
  const returnTo = route.params?.returnTo;
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!/^0\d{9}$/.test(phone)) {
      setPhoneError('กรอกเบอร์โทร 10 หลัก เช่น 0812345678');
      return;
    }
    setPhoneError(null);

    setLoading(true);
    try {
      const data = await apiRequest<{ message: string; devCode?: string }>('/v1/auth/otp/request', {
        method: 'POST',
        body: { phone, purpose: 'login' },
        auth: false,
      });
      // devCode only comes back outside production (dev-OTP backend, no real SMS sent) —
      // shown as an explicit popup so it's unmistakable, rather than relying on the
      // small badge on OtpScreen alone.
      if (data.devCode) {
        Alert.alert('รหัส OTP (โหมดทดสอบ)', `รหัสของคุณคือ ${data.devCode}`, [
          {
            text: 'ตกลง',
            onPress: () => navigation.navigate('Otp', { phone, purpose: 'login', devCode: data.devCode, returnTo }),
          },
        ]);
      } else {
        navigation.navigate('Otp', { phone, purpose: 'login', devCode: data.devCode, returnTo });
      }

    } catch (err) {
      // Login no longer creates accounts — send an unknown number to sign-up instead.
      if (isApiError(err, 'NOT_REGISTERED')) {
        Alert.alert('เบอร์นี้ยังไม่ได้สมัครสมาชิก', 'สมัครสมาชิกก่อน แล้วจึงเข้าสู่ระบบด้วยเบอร์นี้ได้', [
          { text: 'ยกเลิก', style: 'cancel' },
          { text: 'สมัครสมาชิก', onPress: () => navigation.navigate('Register', { returnTo }) },
        ]);
        return;
      }
      setError(errorMessageTh(err, 'ส่งรหัส OTP ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  const onSocialPress = (provider: 'Gmail' | 'LINE') => {
    Alert.alert('เร็ว ๆ นี้', `เข้าสู่ระบบด้วย ${provider} ยังไม่เปิดให้บริการ — ตอนนี้ใช้เบอร์โทรศัพท์ไปก่อนนะ`);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <LinearGradient
          colors={[colors.primary, colors.primaryDark]}
          start={{ x: 0.15, y: 0.1 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.logoBox}
        >
          <Ionicons name="ticket" size={36} color="#fff" />
        </LinearGradient>
        <Text style={styles.title}>E-ticket</Text>
        <Text style={styles.subtitle}>เข้าสู่ระบบด้วยเบอร์โทรศัพท์ เราจะส่งรหัส OTP 6 หลักให้</Text>

        <View style={styles.form}>
          <FormField
            label="เบอร์โทรศัพท์"
            placeholder="08XXXXXXXX"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            maxLength={10}
            value={phone}
            onChangeText={(v) => {
              setPhone(v.replace(/\D/g, ''));
              if (phoneError) setPhoneError(null);
            }}
            error={phoneError}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
          <ErrorBanner message={error} />
          <PrimaryButton title="ขอรหัส OTP" onPress={onSubmit} loading={loading} />
        </View>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>หรือ</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.socialButton}
          onPress={() => onSocialPress('Gmail')}
          accessibilityRole="button"
          accessibilityLabel="เข้าสู่ระบบด้วย Gmail (เร็ว ๆ นี้)"
        >
          <Ionicons name="mail-outline" size={18} color={colors.text} />
          <Text style={styles.socialText}>เข้าสู่ระบบด้วย Gmail</Text>
          <View style={styles.soonChip}>
            <Text style={styles.soonText}>เร็ว ๆ นี้</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.socialButton, styles.lineButton]}
          onPress={() => onSocialPress('LINE')}
          accessibilityRole="button"
          accessibilityLabel="เข้าสู่ระบบด้วย LINE (เร็ว ๆ นี้)"
        >
          <Ionicons name="chatbubble" size={18} color="#fff" />
          <Text style={[styles.socialText, styles.lineText]}>เข้าสู่ระบบด้วย LINE</Text>
          <View style={[styles.soonChip, styles.soonChipOnGreen]}>
            <Text style={[styles.soonText, styles.lineText]}>เร็ว ๆ นี้</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** LINE's own brand green — the button must look like LINE, not like our theme. */
const LINE_GREEN = '#06C755';

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  logoBox: {
    width: 88, height: 88, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: spacing.md,
    shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16,
    elevation: 8,
  },
  title: { fontSize: 28, lineHeight: 38, fontWeight: '700', textAlign: 'center', color: colors.text, letterSpacing: -0.3 },
  subtitle: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.lg },
  form: { gap: spacing.md },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...type.caption, marginHorizontal: spacing.md, color: colors.textMuted },
  socialButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill,
    minHeight: 52, marginBottom: spacing.sm, backgroundColor: colors.surface,
  },
  socialText: { ...type.bodyStrong, color: colors.text },
  soonChip: { backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  soonChipOnGreen: { backgroundColor: 'rgba(0,0,0,0.18)' },
  soonText: { ...type.captionStrong, color: colors.textMuted },
  lineButton: { backgroundColor: LINE_GREEN, borderColor: LINE_GREEN },
  lineText: { color: '#fff' },
});
