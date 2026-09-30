import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { colors, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

// ฟอร์มสมัคร: ชื่อ/เบอร์/อีเมล — ไม่มีรหัสผ่าน เพราะระบบยืนยันตัวตนด้วย OTP ล้วน ๆ
// (User model ไม่มีช่อง password — ดู backend/prisma/schema.prisma)
//
// OTP ส่งผ่าน backend (POST /v1/auth/otp/request, purpose: 'register' — เก็บใน Redis)
// ชื่อ/อีเมลที่กรอกที่นี่ถูกส่งต่อไปให้ OtpScreen บันทึกผ่าน PATCH /v1/me หลัง verify OTP
// สำเร็จ (endpoint เดียวกับที่ EditProfileScreen ใช้)
export default function RegisterScreen({ navigation, route }: Props) {
  const returnTo = route.params?.returnTo;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string; terms?: string }>({});

  const onSubmit = async () => {
    setError(null);

    // Validate every field at once so the user sees all problems together, each next
    // to its own field — same checks as before, only where the message shows changed.
    const trimmedName = name.trim();
    const nextErrors: typeof fieldErrors = {};
    if (!trimmedName) nextErrors.name = 'กรอกชื่อ-นามสกุล';
    if (!/^0\d{9}$/.test(phone)) nextErrors.phone = 'กรอกเบอร์โทร 10 หลัก เช่น 0812345678';
    if (!agreed) nextErrors.terms = 'ต้องยอมรับข้อตกลงและเงื่อนไขก่อนสมัครสมาชิก';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const data = await apiRequest<{ message: string; devCode?: string }>('/v1/auth/otp/request', {
        method: 'POST',
        body: { phone, purpose: 'register' },
        auth: false,
      });
      const trimmedEmail = email.trim() || undefined;
      // devCode only comes back outside production (dev-OTP backend, no real SMS sent) —
      // shown as an explicit popup so it's unmistakable, rather than relying on the
      // small badge on OtpScreen alone.
      if (data.devCode) {
        Alert.alert('รหัส OTP (โหมดทดสอบ)', `รหัสของคุณคือ ${data.devCode}`, [
          {
            text: 'ตกลง',
            onPress: () =>
              navigation.navigate('Otp', {
                phone,
                purpose: 'register',
                devCode: data.devCode,
                name: trimmedName,
                email: trimmedEmail,
                returnTo,
              }),
          },
        ]);
      } else {
        navigation.navigate('Otp', {
          phone,
          purpose: 'register',
          devCode: data.devCode,
          name: trimmedName,
          email: trimmedEmail,
          returnTo,
        });
      }
    } catch (err) {
      // Registering never logs into an existing account — point them at login instead.
      if (isApiError(err, 'ALREADY_REGISTERED')) {
        Alert.alert('เบอร์นี้สมัครแล้ว', 'เข้าสู่ระบบด้วยเบอร์นี้ได้เลย', [
          { text: 'ยกเลิก', style: 'cancel' },
          { text: 'เข้าสู่ระบบ', onPress: () => navigation.navigate('Login', { returnTo }) },
        ]);
        return;
      }
      setError(errorMessageTh(err, 'ส่งรหัส OTP ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <LinearGradient
            colors={[colors.primary, colors.primaryDark]}
            start={{ x: 0.15, y: 0.1 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.logoBox}
          >
            <Ionicons name="ticket" size={26} color="#fff" />
          </LinearGradient>
          <View style={styles.headerText}>
            <Text style={styles.title}>สมัครสมาชิก</Text>
            <Text style={styles.subtitle}>เริ่มเก็บคูปองส่วนลดร้านโปรดของคุณ</Text>
          </View>
        </View>

        <FormField
          label="ชื่อ-นามสกุล"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (fieldErrors.name) setFieldErrors((e) => ({ ...e, name: undefined }));
          }}
          placeholder="กรอกชื่อ-นามสกุล"
          autoCapitalize="words"
          textContentType="name"
          maxLength={100}
          error={fieldErrors.name}
        />
        <FormField
          label="เบอร์โทรศัพท์"
          value={phone}
          onChangeText={(v) => {
            setPhone(v.replace(/\D/g, ''));
            if (fieldErrors.phone) setFieldErrors((e) => ({ ...e, phone: undefined }));
          }}
          placeholder="08XXXXXXXX"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          maxLength={10}
          error={fieldErrors.phone}
          helperText="เราจะส่งรหัส OTP ไปที่เบอร์นี้"
        />
        <FormField
          label="อีเมล (ไม่บังคับ)"
          value={email}
          onChangeText={setEmail}
          placeholder="กรอกอีเมล"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoCapitalize="none"
          maxLength={120}
        />

        <View>
          <View style={styles.termsRow}>
            <Pressable
              style={styles.checkbox}
              onPress={() => {
                setAgreed((a) => !a);
                if (fieldErrors.terms) setFieldErrors((e) => ({ ...e, terms: undefined }));
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel="ยอมรับข้อตกลงและเงื่อนไข"
            >
              <Ionicons
                name={agreed ? 'checkbox' : 'square-outline'}
                size={24}
                color={agreed ? colors.primary : fieldErrors.terms ? colors.danger : colors.borderStrong}
              />
            </Pressable>
            <Text style={styles.termsText}>
              ยอมรับ{' '}
              <Text style={styles.termsLink} onPress={() => navigation.navigate('Tos')} accessibilityRole="link">
                ข้อตกลงและเงื่อนไข
              </Text>
            </Text>
          </View>
          {fieldErrors.terms ? <Text style={styles.termsError}>{fieldErrors.terms}</Text> : null}
        </View>

        <ErrorBanner message={error} />

        <PrimaryButton title="สมัครสมาชิก" onPress={onSubmit} loading={loading} style={styles.submitBtn} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  logoBox: {
    width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 10,
    elevation: 6,
  },
  headerText: { flex: 1 },
  title: { ...type.title, color: colors.text, letterSpacing: -0.3 },
  subtitle: { ...type.bodySmall, color: colors.textMuted },
  termsRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  termsText: { ...type.body, color: colors.text, flex: 1 },
  termsLink: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  termsError: { ...type.caption, color: colors.danger, marginLeft: touch.min - 10 },
  submitBtn: { marginTop: spacing.xs },
});
