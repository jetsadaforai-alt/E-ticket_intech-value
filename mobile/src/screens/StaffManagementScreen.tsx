import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import BottomTabBar from '../components/BottomTabBar';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useRequireMode } from '../hooks/useRequireMode';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffManagement'>;

type StaffItem = { id: string; role: string; status: string; user: { name: string; phone: string } };

const ROLE_TH: Record<string, string> = { manager: 'ผู้จัดการ', staff: 'พนักงาน' };
const STATUS_TH: Record<string, string> = { active: 'ทำงานอยู่', invited: 'รอตอบรับคำเชิญ' };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function StaffManagementScreen({ route, navigation }: Props) {
  const { shopId } = route.params;
  useRequireMode(['vendor'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), shopId);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true); // ครั้งแรกเท่านั้น
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<StaffItem[]>(`/v1/shops/${shopId}/staff`);
      setStaff(data);
      setLoadError(null);
    } catch {
      setLoadError('โหลดรายชื่อพนักงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const onInvite = async () => {
    setInviteError(null);
    if (!/^0\d{9}$/.test(phone)) {
      setInviteError('กรอกเบอร์โทร 10 หลัก');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/v1/shops/${shopId}/staff/invite`, { method: 'POST', body: { phone } });
      setPhone('');
      await load();
    } catch (err) {
      setInviteError(
        err instanceof ApiError && err.message === 'ALREADY_INVITED_OR_ACTIVE'
          ? 'เบอร์นี้อยู่ในทีมแล้ว'
          : err instanceof ApiError && err.message === 'NOT_REGISTERED'
          ? 'เบอร์นี้ยังไม่ได้สมัครใช้งานแอป ให้พนักงานสมัครสมาชิกก่อนแล้วค่อยเชิญ'
          : 'เชิญไม่สำเร็จ ลองใหม่อีกครั้ง'
      );
    } finally {
      setBusy(false);
    }
  };

  // Confirm dialog ก่อนลบยังเป็น Alert ตั้งใจ — เป็น destructive confirm ไม่ใช่ error display
  const onRemove = (item: StaffItem) => {
    Alert.alert('ลบพนักงาน', `เอา ${item.user.name} ออกจากร้าน? พนักงานจะสแกนตั๋วของร้านนี้ไม่ได้อีก`, [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          setRemoveError(null);
          try {
            await apiRequest(`/v1/shops/${shopId}/staff/${item.id}`, { method: 'DELETE' });
            await load();
          } catch {
            setRemoveError('ลบพนักงานไม่สำเร็จ ลองใหม่อีกครั้ง');
          }
        },
      },
    ]);
  };

  let body: React.ReactNode;
  if (loading) {
    body = <LoadingView label="กำลังโหลดรายชื่อพนักงาน..." />;
  } else if (loadError) {
    body = (
      <View style={styles.errorWrap}>
        <ErrorBanner message={loadError} />
        <PrimaryButton title="ลองใหม่" onPress={load} style={styles.retryBtn} />
      </View>
    );
  } else {
    body = (
      <>
        <ErrorBanner message={removeError} />
        <FlatList
          data={staff}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีพนักงาน</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(item.user.name)}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardName}>{item.user.name}</Text>
                <Text style={styles.cardMeta}>
                  {ROLE_TH[item.role] ?? item.role} · {item.user.phone}
                </Text>
              </View>
              <View style={styles.cardRight}>
                <View style={[styles.statusPill, item.status === 'active' ? styles.statusPillActive : styles.statusPillPending]}>
                  <View style={[styles.statusDot, item.status === 'active' ? styles.statusDotActive : styles.statusDotPending]} />
                  <Text style={[styles.statusText, item.status === 'active' ? styles.statusTextActive : styles.statusTextPending]}>
                    {STATUS_TH[item.status] ?? item.status}
                  </Text>
                </View>
                {/* managers can't be removed here — the backend rejects it, since an
                    owner's manager row is what grants them shop access at all */}
                {item.role === 'staff' && (
                  <TouchableOpacity onPress={() => onRemove(item)} hitSlop={8}>
                    <Text style={styles.removeText}>ลบ</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.inviteBox}>
        <View style={{ flex: 1 }}>
          <FormField
            label="เบอร์โทรพนักงานที่จะเชิญ"
            placeholder="0812345678"
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
          />
        </View>
        <View style={styles.inviteButtonWrap}>
          <PrimaryButton title={busy ? '...' : 'เชิญ'} onPress={onInvite} disabled={busy || phone.length !== 10} />
        </View>
      </View>
      <ErrorBanner message={inviteError} />

      {body}

      <BottomTabBar active="StaffManagement" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inviteBox: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    margin: spacing.md, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.card,
    ...shadows.card,
  },
  inviteButtonWrap: { width: 80 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
  errorWrap: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  retryBtn: { alignSelf: 'stretch' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.card,
    ...shadows.card,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: colors.primary },
  cardBody: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardMeta: { fontSize: 13, color: colors.textMuted },
  cardRight: { alignItems: 'flex-end', gap: spacing.xs },
  removeText: { fontSize: 13, color: colors.danger, fontWeight: '600' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  statusPillActive: { backgroundColor: colors.primaryPill },
  statusPillPending: { backgroundColor: colors.warningBg },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotActive: { backgroundColor: colors.success },
  statusDotPending: { backgroundColor: colors.warning },
  statusText: { fontSize: 12, fontWeight: '600' },
  statusTextActive: { color: colors.primaryPillText },
  statusTextPending: { color: colors.warning },
});
