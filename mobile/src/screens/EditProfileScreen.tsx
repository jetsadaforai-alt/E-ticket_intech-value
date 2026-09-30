import React, { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner } from '../components/ErrorBanner';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useToast } from '../components/Toast';
import { resolveAssetUrl } from '../utils/assetUrl';
import { toJpegAsset, buildSingleImageFormData } from '../utils/imageUpload';
import { colors, spacing, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

// เปลี่ยนได้เฉพาะชื่อและอีเมล — เบอร์โทรเป็น identity หลักของบัญชี แก้ไม่ได้
export default function EditProfileScreen({ navigation }: Props) {
  const { me, refreshMe } = useAuth();
  // เข้าถึงได้จากทั้งโหมดลูกค้าและร้านค้า (แก้ไขข้อมูลส่วนตัว ไม่ใช่ข้อมูลร้าน) ต้องอ่านสีตามโหมด
  const c = useColors();
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const toast = useToast();

  // Same pick→convert→upload flow as ShopProductsScreen.tsx's onPickImage, just pointed
  // at /v1/me/avatar instead of a product. Reuses this screen's own ErrorBanner/error
  // state rather than a second error channel.
  const onPickAvatar = async () => {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setError('ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;

      setUploadingAvatar(true);
      const asset = await toJpegAsset(result.assets[0], 0);
      await apiRequest('/v1/me/avatar', { method: 'POST', formData: buildSingleImageFormData(asset) });
      await refreshMe();
      toast('เปลี่ยนรูปโปรไฟล์แล้ว');
    } catch (err) {
      // was err.message — raw codes like FILE_TOO_LARGE reached the user
      setError(errorMessageTh(err, 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('ชื่อต้องไม่เป็นค่าว่าง');
      return;
    }
    setNameError(null);
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/v1/me', { method: 'PATCH', body: { name: trimmedName, email: email.trim() } });
      await refreshMe();
      // Toast (not a blocking popup) — same outcome as before: saved, then back.
      toast('บันทึกข้อมูลโปรไฟล์แล้ว');
      navigation.goBack();
    } catch (err) {
      setError(errorMessageTh(err, 'บันทึกข้อมูลโปรไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        <TouchableOpacity
          style={styles.avatarPicker}
          onPress={onPickAvatar}
          disabled={uploadingAvatar}
          accessibilityRole="button"
          accessibilityLabel="เปลี่ยนรูปโปรไฟล์"
          accessibilityState={{ busy: uploadingAvatar }}
        >
          {me?.avatar_url ? (
            <Image source={{ uri: resolveAssetUrl(me.avatar_url) ?? undefined }} style={[styles.avatarImage, { backgroundColor: c.primarySoft }]} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: c.primarySoft }]}>
              <Ionicons name="person" size={32} color={colors.textMuted} />
            </View>
          )}
          {uploadingAvatar ? (
            <View style={styles.avatarBusy}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
          <View style={[styles.avatarEditBadge, { backgroundColor: c.primary }]}>
            <Ionicons name="camera" size={16} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>{uploadingAvatar ? 'กำลังอัปโหลดรูป...' : 'แตะที่รูปเพื่อเปลี่ยนรูปโปรไฟล์'}</Text>

        <FormField
          label="ชื่อที่แสดง"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (nameError) setNameError(null);
          }}
          placeholder="ชื่อของคุณ"
          autoCapitalize="words"
          maxLength={100}
          error={nameError}
        />
        <FormField
          label="อีเมล"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          maxLength={120}
          helperText="ไม่บังคับ — เว้นว่างไว้ได้ถ้าไม่ต้องการใช้อีเมล"
        />
        <FormField label="เบอร์โทร" value={me?.phone ?? '-'} editable={false} helperText="เบอร์โทรใช้เป็นบัญชีล็อกอิน แก้ไขไม่ได้" />
        <PrimaryButton title="บันทึก" onPress={onSave} loading={submitting} disabled={!name.trim()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  avatarPicker: { alignSelf: 'center', marginTop: spacing.sm },
  avatarImage: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarBusy: {
    position: 'absolute', top: 0, left: 0, width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute', right: -4, bottom: -4,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  avatarHint: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.sm },
});
