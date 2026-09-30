import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { Text } from '../components/AppText';
import { resolveAssetUrl } from '../utils/assetUrl';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { useMode } from '../context/ModeContext';
import BottomTabBar from '../components/BottomTabBar';
import { SwitchingModeOverlay } from '../components/SwitchingModeOverlay';
import type { AppMode } from '../storage/appMode';
import { APP_VERSION } from '../appInfo';
import { colors, radius, shadows, spacing, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

// ฟีเจอร์ที่ยังไม่มี backend รองรับใน scope นี้ — คงปุ่มไว้ให้ layout ครบตามดีไซน์
// (แนวเดียวกับปุ่ม Gmail/LINE ในหน้า login ที่เป็น placeholder) แต่บอกผู้ใช้ตรง ๆ เมื่อกด
function notAvailableYet(feature: string) {
  Alert.alert(feature, 'ฟีเจอร์นี้ยังไม่เปิดใช้งานในเวอร์ชันนี้');
}

function initialsOf(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function ProfileScreen({ navigation }: Props) {
  const { me, logout } = useAuth();
  const { mode, setMode, canVendor, canStaff, vendorShopId } = useMode();
  // เป็นแท็บที่มีอยู่ในทุกโหมด สีแบรนด์จึงต้องเปลี่ยนตามโหมดที่ใช้อยู่
  const c = useColors();

  const onLogout = async () => {
    setMode('customer');
    await logout();
    // Landing (not Login) — otherwise a logged-out user can only reach Login, with
    // no way back to Register (reported bug: logout left no path to sign up again).
    navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
  };

  const vendorInfo = me?.roles.vendorOwner[0]; // ALREADY_HAS_VENDOR ที่ backend บังคับไว้ทำให้มีได้แค่ 1
  const hasVendor = Boolean(vendorInfo);

  // "กำลังสลับโหมด" overlay (Figma 352:4302) — purely a cosmetic pause, setMode() itself is
  // synchronous with no real async work underneath. The timer must be cleared on unmount so a
  // fast back-navigation before it fires doesn't call setState on an unmounted screen.
  const [switchingTo, setSwitchingTo] = useState<AppMode | null>(null);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (switchTimer.current) clearTimeout(switchTimer.current);
    },
    []
  );
  const beginSwitch = (target: AppMode, after: () => void) => {
    setSwitchingTo(target);
    switchTimer.current = setTimeout(after, 600);
  };

  // setMode must land before the navigate — the destination's mode guard reads the
  // context on mount, and would bounce the user straight back on a stale value.
  const enterVendor = () => {
    if (!vendorShopId) return;
    beginSwitch('vendor', () => {
      setMode('vendor');
      navigation.replace('ShopDashboard', { shopId: vendorShopId });
    });
  };
  const enterStaff = () => {
    beginSwitch('staff', () => {
      setMode('staff');
      navigation.replace('Scanner', {});
    });
  };
  const backToCustomer = () => {
    beginSwitch('customer', () => {
      setMode('customer');
      navigation.replace('Home');
    });
  };

  const modeLabel =
    mode === 'vendor' ? 'โหมดปัจจุบัน: ร้านค้า' : mode === 'staff' ? 'โหมดปัจจุบัน: staff' : 'โหมดปัจจุบัน: ลูกค้า';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.avatarWrap}>
          {me?.avatar_url ? (
            <Image source={{ uri: resolveAssetUrl(me.avatar_url) ?? undefined }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: c.primarySoft }]}>
              <Text style={[styles.avatarText, { color: c.primary }]}>{initialsOf(me?.name)}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.avatarEditBadge, { backgroundColor: c.primary }]}
            onPress={() => navigation.navigate('EditProfile')}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="แก้ไขโปรไฟล์"
          >
            <Ionicons name="pencil" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        <Text style={styles.name}>{me?.name}</Text>
        <Text style={styles.email}>{me?.email || me?.phone}</Text>

        <View style={[styles.roleChip, { backgroundColor: c.primarySoft }]}>
          <Ionicons name="person-circle-outline" size={14} color={c.primary} />
          <Text style={[styles.roleChipText, { color: c.primary }]}>{modeLabel}</Text>
        </View>

        {/* Modes are mutually exclusive: in vendor/staff mode the only affordance is
            the way back, so the customer-side entry points stay out of reach. */}
        {mode === 'customer' ? (
          <>
            {canVendor && (
              <ModeCard
                icon="storefront-outline"
                title="E-Ticket: สลับเป็นโหมดร้านค้า"
                status="เปิดให้บริการ"
                onPress={enterVendor}
              />
            )}
            {canStaff && (
              <ModeCard
                icon="scan-outline"
                title="E-Ticket: สลับเป็นโหมด staff"
                status="พร้อมสแกนตั๋ว"
                onPress={enterStaff}
              />
            )}
            {!hasVendor && (
              <ModeCard
                icon="add-circle-outline"
                title="E-Ticket: สมัครเป็นร้านค้า"
                status="ยังไม่ได้สมัคร"
                onPress={() => navigation.navigate('VendorSignup')}
              />
            )}
            {hasVendor && !canVendor && vendorInfo && (
              <ModeCard
                icon={vendorInfo.verificationStatus === 'approved' ? 'checkmark-circle-outline' : vendorInfo.verificationStatus === 'rejected' ? 'alert-circle-outline' : 'time-outline'}
                title="E-Ticket: ดูสถานะร้านค้า"
                status={
                  vendorInfo.verificationStatus === 'approved' && !vendorInfo.hasShop
                    ? 'อนุมัติแล้ว — รอตั้งค่าร้าน'
                    : vendorInfo.verificationStatus === 'rejected'
                    ? 'ถูกปฏิเสธ'
                    : 'รอตรวจสอบ'
                }
                onPress={() => navigation.navigate('VendorSignup')}
              />
            )}
          </>
        ) : (
          <ModeCard
            icon="swap-horizontal-outline"
            title="E-Ticket: สลับกลับเป็นโหมดลูกค้า"
            status={mode === 'vendor' ? 'กำลังใช้โหมดร้านค้า' : 'กำลังใช้โหมด staff'}
            onPress={backToCustomer}
          />
        )}

        {mode === 'vendor' && vendorShopId && (
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>ร้านค้า</Text>
            <SettingRow
              icon="storefront-outline"
              label="ตั้งค่าร้านค้า"
              onPress={() => navigation.navigate('ShopSetup', { shopId: vendorShopId })}
              isLast
            />
          </View>
        )}

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>การตั้งค่าบัญชี</Text>

          <SettingRow icon="person-outline" label="แก้ไขโปรไฟล์" onPress={() => navigation.navigate('EditProfile')} />
          <SettingRow icon="globe-outline" label="ภาษา (Language)" value="ไทย" onPress={() => notAvailableYet('เปลี่ยนภาษา')} />
          <SettingRow
            icon="shield-checkmark-outline"
            label="ความเป็นส่วนตัวและความปลอดภัย"
            onPress={() => navigation.navigate('Tos')}
          />
          <SettingRow
            icon="help-buoy-outline"
            label="ช่วยเหลือและแจ้งปัญหา"
            onPress={() => navigation.navigate('SupportList')}
            isLast
          />
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={onLogout} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>ออกจากระบบ</Text>
        </TouchableOpacity>

        <Text style={styles.version}>E-Ticket v{APP_VERSION}</Text>
      </ScrollView>

      <BottomTabBar active="Profile" navigation={navigation} />
      <SwitchingModeOverlay visible={switchingTo !== null} target={switchingTo ?? 'customer'} />
    </View>
  );
}

function ModeCard({
  icon,
  title,
  status,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  status: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <TouchableOpacity
      style={[styles.modeCard, { borderColor: c.primary }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} ${status}`}
    >
      <View style={styles.modeCardTextWrap}>
        <Text style={[styles.modeCardTitle, { color: c.primaryDark }]}>{title}</Text>
        <View style={styles.modeCardStatusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.modeCardStatus}>{status}</Text>
        </View>
      </View>
      <View style={[styles.modeCardIcon, { backgroundColor: c.primary }]}>
        <Ionicons name={icon} size={20} color="#fff" />
      </View>
    </TouchableOpacity>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  isLast = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const c = useColors();
  return (
    <TouchableOpacity
      style={[styles.settingRow, !isLast && styles.settingRowBorder]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label} ${value}` : label}
    >
      <View style={styles.settingIconBubble}>
        <Ionicons name={icon} size={18} color={c.primary} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.md, paddingBottom: spacing.lg, alignItems: 'stretch' },

  avatarWrap: { alignSelf: 'center', marginTop: spacing.sm },
  avatar: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.surface,
    ...shadows.card,
  },
  avatarText: { fontSize: 32, lineHeight: 44, fontWeight: '700', color: colors.primary },
  // 36px visible + 4px hitSlop each side = 44px touch area (was 30px)
  avatarEditBadge: {
    position: 'absolute', right: -4, bottom: -4,
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },

  name: { ...type.title, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  email: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },

  roleChip: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 2, marginTop: spacing.sm,
  },
  roleChipText: { ...type.captionStrong, color: colors.primary },

  modeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.card,
    borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginTop: spacing.md,
    ...shadows.card,
  },
  modeCardTextWrap: { flex: 1, gap: 2 },
  // สีหัวข้อการ์ด = primaryDark ของโหมดปัจจุบัน (เดิม #00288E ตายตัว ซึ่งเป็นน้ำเงินแม้อยู่โหมดลูกค้า)
  modeCardTitle: { ...type.bodyStrong, fontWeight: '700' },
  modeCardStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  modeCardStatus: { ...type.caption, color: colors.textMuted },
  modeCardIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  settingsCard: {
    backgroundColor: colors.surface, borderRadius: radius.card,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, marginTop: spacing.md,
    ...shadows.card,
  },
  settingsTitle: { ...type.label, color: colors.textMuted, marginBottom: spacing.xs },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingVertical: 8 },
  settingRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  settingIconBubble: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutralBubble,
    alignItems: 'center', justifyContent: 'center',
  },
  settingLabel: { ...type.body, flex: 1, color: colors.text },
  settingValue: { ...type.bodySmall, color: colors.textMuted },

  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerBg, borderRadius: radius.pill,
    minHeight: 52, marginTop: spacing.md,
  },
  logoutText: { ...type.button, color: colors.danger },

  version: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
