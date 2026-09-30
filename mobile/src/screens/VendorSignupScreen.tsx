import React, { useCallback, useEffect, useState } from 'react';
import { View, TouchableOpacity, Image, StyleSheet, Alert, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { useAuth } from '../context/AuthContext';
import { useMode } from '../context/ModeContext';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
import { ErrorBanner } from '../components/ErrorBanner';
import { useToast } from '../components/Toast';
import { buildImageFormDataWithFields, toJpegAsset, type UploadableImage } from '../utils/imageUpload';
import { colors, radius, shadows, spacing, type } from '../theme';

const MAX_DOCUMENTS = 3; // matches MAX_DOCUMENTS_PER_VENDOR in backend/src/routes/vendors.js

type Props = NativeStackScreenProps<RootStackParamList, 'VendorSignup'>;

type Vendor = {
  id: string;
  name: string;
  verificationStatus: string;
  // active | suspended — a separate axis from verificationStatus (a vendor can be
  // 'approved' and 'suspended' at the same time). See schema.prisma comment on Vendor.status.
  status: string;
  suspendedReason: string | null;
  verification: { status: string; reason: string | null; appealCount: number };
  shop: { id: string } | null;
};

export default function VendorSignupScreen({ navigation }: Props) {
  const { refreshMe } = useAuth();
  const { setMode } = useMode();
  const [vendor, setVendor] = useState<Vendor | 'none' | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [documents, setDocuments] = useState<UploadableImage[]>([]);
  const [appealReason, setAppealReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const data = await apiRequest<Vendor>('/v1/vendors/me');
      setVendor(data);
    } catch (err) {
      // Only a real "no vendor yet" response means the signup form belongs here —
      // any other error (network blip, 500, etc.) must not be treated the same way,
      // or an already-registered vendor gets shown the signup form again.
      if (err instanceof ApiError && err.message === 'NO_VENDOR') {
        setVendor('none');
      } else {
        setLoadError(true);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Vendor status comes from /v1/vendors/me, which is a different source than
  // me.roles — refresh the latter before switching so vendor mode is actually allowed.
  // Also gated on vendor.status !== 'suspended': without this a suspended vendor with an
  // existing shop would bounce straight into ShopDashboard, hit 403 VENDOR_SUSPENDED
  // there, and get sent right back here — a redirect loop instead of the status screen.
  useEffect(() => {
    if (vendor && vendor !== 'none' && vendor.verificationStatus === 'approved' && vendor.shop && vendor.status !== 'suspended') {
      const shopId = vendor.shop.id;
      (async () => {
        await refreshMe();
        setMode('vendor');
        navigation.replace('ShopDashboard', { shopId });
      })();
    }
  }, [vendor, navigation, refreshMe, setMode]);

  const pickDocument = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('ต้องอนุญาต', 'ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_DOCUMENTS - documents.length,
        quality: 0.7,
      });
      if (result.canceled) return;

      const picked = await Promise.all(result.assets.map(toJpegAsset));
      setDocuments((prev) => [...prev, ...picked].slice(0, MAX_DOCUMENTS));
    } catch (err) {
      // Picker/conversion errors are native English messages — never shown to users.
      console.warn('Document pick failed:', err);
      Alert.alert('เลือกรูปไม่สำเร็จ', 'ลองเลือกรูปอื่นหรือลองใหม่อีกครั้ง');
    }
  };

  const onSignup = async () => {
    setSignupError(null);
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiRequest('/v1/vendors', {
        method: 'POST',
        formData: buildImageFormDataWithFields(documents, 'documents', { name: name.trim() }),
      });
      await load();
      toast('ส่งคำขอเปิดร้านแล้ว รอเจ้าหน้าที่ตรวจสอบ');
    } catch (err) {
      setSignupError(errorMessageTh(err, 'สมัครไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setBusy(false);
    }
  };

  const onCheckStatus = async () => {
    setChecking(true);
    await load();
    setChecking(false);
  };

  const onAppeal = async () => {
    setAppealError(null);
    if (!appealReason.trim() || vendor === 'none' || !vendor) return;
    setBusy(true);
    try {
      await apiRequest(`/v1/vendors/${vendor.id}/appeal`, { method: 'POST', body: { reason: appealReason.trim() } });
      setAppealReason('');
      await load();
      toast('ยื่นอุทธรณ์แล้ว เจ้าหน้าที่จะพิจารณาอีกครั้ง');
    } catch (err) {
      setAppealError(errorMessageTh(err, 'ยื่นอุทธรณ์ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <View style={styles.loading}>
        <EmptyState icon="cloud-offline-outline" title="โหลดข้อมูลร้านค้าไม่สำเร็จ" hint="ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" />
        <PrimaryButton title="ลองใหม่" icon="refresh" onPress={load} style={styles.fullWidthBtn} />
      </View>
    );
  }

  if (vendor === null) {
    return <LoadingView label="กำลังโหลดข้อมูลร้านค้า..." />;
  }

  // สมัครใหม่ (Figma 325:2618) — คงแค่ "ชื่อร้าน" + "เอกสารยืนยันตัวตน" ที่มี field รองรับจริงใน
  // backend (Vendor.documents) ส่วนหมวดหมู่/ที่อยู่/เลขภาษี/เบอร์ติดต่อที่ Figma ออกแบบไว้ยังไม่มี
  // field รองรับ — จึงตัดออก
  if (vendor === 'none') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.intro}>กรอกข้อมูลเพื่อสมัครเป็นร้านค้าบนแพลตฟอร์ม เจ้าหน้าที่จะตรวจสอบก่อนเปิดใช้งาน</Text>
          <View style={styles.fieldGroup}>
            <FormField
              label="ชื่อร้าน"
              placeholder="ระบุชื่อร้านของคุณ"
              value={name}
              onChangeText={setName}
              maxLength={100}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>เอกสารยืนยันตัวตน (ไม่บังคับ, สูงสุด {MAX_DOCUMENTS} รูป)</Text>
            <View style={styles.docRow}>
              {documents.map((doc, i) => (
                <View key={doc.uri} style={styles.docThumbWrap}>
                  <Image source={{ uri: doc.uri }} style={styles.docThumb} />
                  <TouchableOpacity
                    style={styles.docRemoveBadge}
                    onPress={() => setDocuments((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`ลบเอกสารรูปที่ ${i + 1}`}
                  >
                    <Ionicons name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {documents.length < MAX_DOCUMENTS && (
                <TouchableOpacity
                  style={styles.docAddButton}
                  onPress={pickDocument}
                  accessibilityRole="button"
                  accessibilityLabel="เพิ่มรูปเอกสาร"
                >
                  <Ionicons name="add" size={24} color={colors.textMuted} />
                  <Text style={styles.docAddText}>เพิ่มรูป</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <ErrorBanner message={signupError} />
          </View>
          <PrimaryButton title="ส่งคำขอ" onPress={onSignup} loading={busy} disabled={!name.trim()} style={styles.fullWidthBtn} />
        </View>
      </ScrollView>
    );
  }

  const status = vendor.verification.status;

  // approved+shop+active redirects via effect above, so by the time we render this
  // branch it's always suspended / pending / rejected / (approved with no shop yet).
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {vendor.status === 'suspended' ? (
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: colors.dangerBg }]}>
            <Ionicons name="ban-outline" size={28} color={colors.danger} />
          </View>
          <Text style={styles.cardTitle}>ร้านค้าถูกระงับ</Text>
          <Text style={styles.vendorName}>{vendor.name}</Text>
          <View style={[styles.pill, { backgroundColor: colors.dangerBg }]}>
            <Text style={[styles.pillText, { color: colors.danger }]}>ถูกระงับ</Text>
          </View>
          {vendor.suspendedReason && (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonTitle}>เหตุผล:</Text>
              <Text style={styles.reasonText}>{vendor.suspendedReason}</Text>
            </View>
          )}
          <Text style={styles.bodyText}>
            ร้านของคุณถูกระงับการใช้งานโดยผู้ดูแลระบบ Event ที่เปิดอยู่ทั้งหมดถูกปิดและตั๋วที่แจกไปแล้วถูกยกเลิก
          </Text>
          <PrimaryButton
            title="ติดต่อเจ้าหน้าที่"
            variant="secondary"
            onPress={() => navigation.navigate('SupportList')}
            style={styles.fullWidthBtn}
          />
        </View>
      ) : (
        <>
      {status === 'pending' && (
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: colors.warningBg }]}>
            <Ionicons name="time-outline" size={28} color={colors.warning} />
          </View>
          <Text style={styles.cardTitle}>รอการตรวจสอบ</Text>
          <Text style={styles.vendorName}>{vendor.name}</Text>
          <View style={[styles.pill, { backgroundColor: colors.warningBg }]}>
            <Text style={[styles.pillText, { color: colors.warning }]}>รอตรวจสอบ</Text>
          </View>
          <Text style={styles.bodyText}>
            เจ้าหน้าที่กำลังตรวจสอบข้อมูลร้านของคุณ กรุณารอการอนุมัติ — เราจะแจ้งผลในหน้าการแจ้งเตือน
          </Text>
          <PrimaryButton
            title="ตรวจสอบสถานะอีกครั้ง"
            icon="refresh"
            variant="secondary"
            onPress={onCheckStatus}
            loading={checking}
            style={styles.fullWidthBtn}
          />
        </View>
      )}

      {status === 'approved' && !vendor.shop && (
        <View style={styles.card}>
          <View style={styles.celebrateGlow}>
            <View style={styles.celebrateCircle}>
              <Ionicons name="checkmark" size={44} color="#fff" />
            </View>
          </View>
          <Text style={[styles.cardTitle, { color: colors.primary }]}>ยินดีด้วย!</Text>
          <View style={[styles.pill, { backgroundColor: colors.success }]}>
            <Text style={[styles.pillText, { color: '#fff' }]}>การสมัครของคุณได้รับการอนุมัติแล้ว</Text>
          </View>
          <Text style={styles.bodyText}>คุณสามารถเริ่มจัดการร้านค้าของคุณบนแพลตฟอร์มของเราได้ทันที</Text>
          <PrimaryButton
            title="ตั้งค่าร้านของฉัน"
            onPress={() => navigation.navigate('ShopSetup', {})}
            style={styles.fullWidthBtn}
          />
        </View>
      )}

      {status === 'rejected' && (
        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: colors.dangerBg }]}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.danger} />
          </View>
          <Text style={styles.cardTitle}>สถานะการสมัครร้านค้า</Text>
          <Text style={styles.vendorName}>{vendor.name}</Text>
          <View style={[styles.pill, { backgroundColor: colors.dangerBg }]}>
            <Text style={[styles.pillText, { color: colors.danger }]}>ถูกปฏิเสธ</Text>
          </View>

          {vendor.verification.reason && (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonTitle}>เหตุผลที่ถูกปฏิเสธ:</Text>
              <Text style={styles.reasonText}>{vendor.verification.reason}</Text>
            </View>
          )}
          <Text style={styles.appealCount}>ยื่นอุทธรณ์ไปแล้ว {vendor.verification.appealCount}/5 ครั้ง</Text>
          <ErrorBanner message={appealError} />

          {vendor.verification.appealCount < 5 ? (
            <>
              <View style={styles.fieldGroup}>
                <FormField
                  label="เหตุผลที่ขอให้พิจารณาใหม่"
                  placeholder="อธิบายสิ่งที่แก้ไขแล้ว หรือข้อมูลเพิ่มเติม"
                  multiline
                  value={appealReason}
                  onChangeText={setAppealReason}
                  style={styles.textarea}
                />
              </View>
              <PrimaryButton
                title="ยื่นอุทธรณ์"
                onPress={onAppeal}
                loading={busy}
                disabled={!appealReason.trim()}
                style={styles.fullWidthBtn}
              />
            </>
          ) : (
            <Text style={styles.limitReached}>ยื่นครบ 5 ครั้งแล้ว กรุณาติดต่อ Admin โดยตรง</Text>
          )}

          <PrimaryButton
            title="ติดต่อเจ้าหน้าที่"
            variant="secondary"
            onPress={() => navigation.navigate('SupportList')}
            style={styles.fullWidthBtn}
          />
        </View>
      )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.md, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card,
    padding: spacing.lg, alignItems: 'center', gap: spacing.sm,
    ...shadows.card,
  },

  intro: { ...type.bodySmall, color: colors.textMuted, alignSelf: 'stretch', marginBottom: spacing.xs },
  fieldGroup: { alignSelf: 'stretch', gap: 6 },
  fieldLabel: { ...type.label, color: colors.text },
  textarea: { height: 100, textAlignVertical: 'top' },

  docRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingTop: 6 },
  docThumbWrap: { position: 'relative' },
  docThumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.background },
  // 28px visible circle + 8px hitSlop each side = 44px touch area
  docRemoveBadge: {
    position: 'absolute', top: -10, right: -10,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  docAddButton: {
    width: 76, height: 76, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.borderStrong, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  docAddText: { ...type.caption, color: colors.textMuted },

  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  vendorName: { ...type.bodySmall, color: colors.textMuted },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { ...type.label, textAlign: 'center' },
  bodyText: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },

  celebrateGlow: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: colors.primaryPill,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  celebrateCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  fullWidthBtn: { alignSelf: 'stretch', marginTop: spacing.xs },

  reasonBox: {
    alignSelf: 'stretch', backgroundColor: colors.neutralBubble,
    borderRadius: radius.md, padding: spacing.md, gap: 4,
    borderLeftWidth: 4, borderLeftColor: colors.danger,
  },
  reasonTitle: { ...type.bodyStrong, color: colors.text },
  reasonText: { ...type.bodySmall, color: colors.textMuted },
  appealCount: { ...type.bodySmall, color: colors.textMuted },
  limitReached: { ...type.bodySmall, color: colors.danger, textAlign: 'center' },
});
