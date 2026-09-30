import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Linking, TouchableOpacity, Image } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import { resolveAssetUrl } from '../utils/assetUrl';
import { toJpegAsset, buildSingleImageFormData } from '../utils/imageUpload';
import { useAuth } from '../context/AuthContext';
import { useMode } from '../context/ModeContext';
import { useRequireMode } from '../hooks/useRequireMode';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { LoadingView } from '../components/LoadingView';
import { ErrorBanner } from '../components/ErrorBanner';
// โทนน้ำเงินคงที่ตั้งใจ แม้ตอนตั้งค่าครั้งแรก (ไม่มี shopId) จะยังอยู่โหมด customer จริงก็ตาม
// (ดู useRequireMode ด้านล่าง — อนุญาต customer เฉพาะเคสนั้น) เพราะเนื้อหาหน้านี้เป็นเรื่องร้านค้า
// ล้วน ๆ ไม่ใช่ mode ปัจจุบันของผู้ใช้ ต่างจาก VendorSignupScreen ที่จงใจใช้เขียว (ดู comment ใน
// theme.ts เรื่อง vendorColors)
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShopSetup'>;

/**
 * Doubles as both first-time setup (no shopId, POST) and editing an existing shop
 * (shopId present, PATCH) — same fields, same card, so a vendor who wants to fix a
 * typo in their shop name or address isn't hunting for a screen that never existed.
 */
export default function ShopSetupScreen({ route, navigation }: Props) {
  const { shopId } = route.params;
  const isEdit = Boolean(shopId);
  const { refreshMe } = useAuth();
  const { setMode } = useMode();
  // ไม่มี shopId = ตั้งค่าครั้งแรกหลังอนุมัติ — ตอนนั้นยังอยู่โหมด customer เสมอ (จะสลับเป็น
  // vendor ได้ก็ต่อเมื่อมีร้านแล้ว ซึ่งหน้านี้เองที่สร้างร้าน) ต้องอนุญาต customer ด้วย ไม่งั้น
  // ติด deadlock เข้าหน้านี้ไม่ได้เลย — มี shopId (แก้ไขร้านเดิม) ยังคงบังคับโหมด vendor เหมือนเดิม
  useRequireMode(
    shopId ? ['vendor'] : ['customer', 'vendor'],
    () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }),
    shopId
  );

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) return;
    try {
      const shop = await apiRequest<{ name: string; address: string; logo_url: string | null }>(`/v1/shops/${shopId}`);
      setName(shop.name);
      setAddress(shop.address);
      setLogoUrl(shop.logo_url);
    } catch {
      setLoadError('โหลดข้อมูลร้านไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  // เหมือน EditProfileScreen.tsx's onPickAvatar เป๊ะ แค่ปลายทางเป็น /v1/shops/:id/logo
  const onPickLogo = async () => {
    if (!shopId) return;
    setSubmitError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setSubmitError('ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;

      setUploadingLogo(true);
      const asset = await toJpegAsset(result.assets[0], 0);
      const updated = await apiRequest<{ logo_url: string | null }>(`/v1/shops/${shopId}/logo`, {
        method: 'POST',
        formData: buildSingleImageFormData(asset),
      });
      setLogoUrl(updated.logo_url);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'อัปโหลดรูปร้านไม่สำเร็จ');
    } finally {
      setUploadingLogo(false);
    }
  };

  const onViewMap = () => {
    if (!address.trim()) return;
    const query = encodeURIComponent(`${name.trim()} ${address.trim()}`.trim());
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const onSubmit = async () => {
    setSubmitError(null);
    if (!name.trim() || !address.trim()) return;
    setBusy(true);
    try {
      if (isEdit) {
        await apiRequest(`/v1/shops/${shopId}`, {
          method: 'PATCH',
          body: { name: name.trim(), address: address.trim() },
        });
        // ยังเป็น Alert ตั้งใจ — success ไม่ใช่ error display
        Alert.alert('บันทึกแล้ว', '', [{ text: 'ตกลง', onPress: () => navigation.goBack() }]);
      } else {
        const shop = await apiRequest<{ id: string }>('/v1/shops', {
          method: 'POST',
          body: { name: name.trim(), address: address.trim() },
        });
        // Creating the shop is what grants the manager role — without refreshing first,
        // me.roles has no manager entry yet, so vendor mode would be rejected and the
        // brand-new owner would be bounced straight out of their own dashboard.
        await refreshMe();
        setMode('vendor');
        navigation.replace('ShopDashboard', { shopId: shop.id });
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.message === 'SHOP_ALREADY_EXISTS'
          ? 'คุณมีร้านอยู่แล้ว'
          : isEdit
            ? 'บันทึกไม่สำเร็จ'
            : 'สร้างร้านไม่สำเร็จ';
      setSubmitError(message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <LoadingView label="กำลังโหลดข้อมูลร้าน..." />;
  }

  if (loadError) {
    return (
      <View style={styles.errorWrap}>
        <ErrorBanner message={loadError} />
        <PrimaryButton title="กลับ" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <ErrorBanner message={submitError} />
        <Text style={styles.title}>{isEdit ? 'แก้ไขข้อมูลร้าน' : 'ตั้งค่าร้านของฉัน'}</Text>
        {!isEdit && <Text style={styles.hint}>1 ร้านต่อบัญชี (ยังไม่รองรับหลายสาขาในเวอร์ชันนี้)</Text>}

        {isEdit && (
          <View style={styles.logoWrap}>
            <TouchableOpacity onPress={onPickLogo} disabled={uploadingLogo}>
              {logoUrl ? (
                <Image source={{ uri: resolveAssetUrl(logoUrl) ?? undefined }} style={styles.logoImage} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Ionicons name="storefront-outline" size={32} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.logoEditBadge}>
                <Ionicons name={uploadingLogo ? 'hourglass-outline' : 'camera'} size={14} color="#fff" />
              </View>
            </TouchableOpacity>
            <Text style={styles.logoHint}>ป้ายร้าน — แตะเพื่อเปลี่ยนรูป</Text>
          </View>
        )}
        <FormField label="ชื่อร้าน" value={name} onChangeText={setName} placeholder="ระบุชื่อร้านของคุณ" />
        <FormField label="ที่อยู่ร้าน" value={address} onChangeText={setAddress} placeholder="ระบุที่อยู่ของร้านค้า" />
        <PrimaryButton title="ดูตำแหน่งบนแผนที่" variant="secondary" onPress={onViewMap} disabled={!address.trim()} />
        <PrimaryButton
          title={busy ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'สร้างร้าน'}
          onPress={onSubmit}
          loading={busy}
          disabled={!name.trim() || !address.trim()}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.md, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card,
    padding: spacing.lg, gap: spacing.md,
    ...shadows.card,
  },
  logoWrap: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  logoImage: { width: 96, height: 96, borderRadius: 20, backgroundColor: colors.primarySoft },
  logoPlaceholder: {
    width: 96, height: 96, borderRadius: 20, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  logoEditBadge: {
    position: 'absolute', right: -4, bottom: -4,
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  logoHint: { fontSize: 12, color: colors.textMuted },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm },
  errorWrap: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
});
