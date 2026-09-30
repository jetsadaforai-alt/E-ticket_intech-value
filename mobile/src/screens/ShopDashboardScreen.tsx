import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Image } from 'react-native';
import { Text } from '../components/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import { resolveAssetUrl } from '../utils/assetUrl';
import { getQuota, type Quota } from '../api/quota';
import BottomTabBar from '../components/BottomTabBar';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { Stat } from '../components/Stat';
import { useMode } from '../context/ModeContext';
import { useRequireMode } from '../hooks/useRequireMode';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, vendorAccent, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShopDashboard'>;

type ShopSummary = {
  name: string;
  address: string;
  logo_url: string | null;
  summary: {
    events_active: number;
    events_total: number;
    tickets_issued: number;
    tickets_redeemed: number;
    total_discount_baht: number;
  };
};

/** เอาแค่ field ที่ใช้จริงจากผลลัพธ์ของ /events/compare (ดู EventCompareScreen.tsx เต็มๆ) —
 * endpoint นี้เรียงจาก tickets_redeemed มากสุดให้แล้ว ตัวแรกของลิสต์คือ Event ที่ "ฮิตสุด"
 * จริง ไม่ต้องเพิ่ม endpoint ใหม่หรือแก้ backend เลย */
type HotEvent = {
  id: string;
  title: string;
  tickets_issued: number;
  tickets_redeemed: number;
  discount_paid_baht: number;
  product_breakdown: { product_name: string; redeemed_count: number }[];
};

export default function ShopDashboardScreen({ route, navigation }: Props) {
  const { shopId } = route.params;
  const { setMode } = useMode();
  const [shop, setShop] = useState<ShopSummary | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [hotEvent, setHotEvent] = useState<HotEvent | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRequireMode(['vendor'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), shopId);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<ShopSummary>(`/v1/shops/${shopId}`);
      setShop(data);
      setError(null);
      // Quota is secondary information — a failure here must not blank out the whole
      // dashboard, so it gets its own catch rather than sharing the one below.
      getQuota()
        .then(setQuota)
        .catch(() => setQuota(null));
      // เหมือนโควตา — เป็นข้อมูลเสริม พังแล้วไม่ควรทำให้ dashboard ทั้งหน้าล่ม
      apiRequest<HotEvent[]>(`/v1/shops/${shopId}/events/compare`)
        .then((rows) => setHotEvent(rows[0]?.tickets_redeemed > 0 ? rows[0] : null))
        .catch(() => setHotEvent(null));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.message === 'VENDOR_SUSPENDED') {
        // Falling back to customer mode here would leave the owner wondering where
        // their shop went — send them to the status screen that actually explains it.
        navigation.replace('VendorSignup');
        return;
      }
      // This screen is a cold-start route in vendor mode, so any other 403 means the
      // stored mode outlived the role — fall back rather than showing a dead shell.
      if (err instanceof ApiError && err.status === 403) {
        setMode('customer');
        return;
      }
      setError('โหลดข้อมูลร้านไม่สำเร็จ');
    }
  }, [shopId, setMode]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // แถบบนสุด (native header) — เดิมมีแค่ชื่อจอ "แดชบอร์ดร้าน" นิ่งๆ — ตอนนี้ใส่ชื่อร้าน
  // กำกับใต้ชื่อจอ + ย้ายรูปโปรไฟล์ร้าน (เดิมเคยลอยอยู่ในการ์ด) มาไว้ตรงนี้แทน ตามที่ขอ
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View>
          <Text style={styles.headerTitle}>แดชบอร์ด</Text>
          {shop && (
            <View style={styles.headerSubtitleRow}>
              <Ionicons name="storefront-outline" size={12} color={colors.textMuted} />
              <Text style={styles.headerSubtitle} numberOfLines={1}>{shop.name}</Text>
            </View>
          )}
        </View>
      ),
      headerRight: shop
        ? () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('ShopSetup', { shopId })}
              hitSlop={8}
              style={styles.headerAvatarButton}
            >
              {shop.logo_url ? (
                <Image source={{ uri: resolveAssetUrl(shop.logo_url) ?? undefined }} style={styles.headerAvatar} />
              ) : (
                <View style={styles.headerAvatarPlaceholder}>
                  <Text style={styles.headerAvatarText}>{shop.name.charAt(0)}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, shop, shopId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ErrorBanner message={error} />

        {shop ? (
          <>
            {/* "Wallet balance" ใน Figma ตีความใหม่เป็นมูลค่าส่วนลดสะสม — ระบบนี้ไม่มีเงินสด/
                ธุรกรรมผ่านแอปเลย (คูปองแจกฟรี) จึงไม่มี "ยอดเงิน" ที่ถอนได้จริง ใช้ total_discount_baht
                ที่ backend คำนวณอยู่แล้วแทน ไม่ต้องแก้ backend เลย — มีคำอธิบายกำกับชัดกันเข้าใจผิด
                ว่าเป็นเงินในบัญชี (คำแนะนำจาก BA หลังเทียบกับ Figma)
                รวม "สรุปของร้าน" เข้ามาเป็นการ์ดเดียวกันตามที่ขอ — แตะได้ทั้งการ์ด พาไปหน้า Event
                ของร้าน (หมวด Event เดิมที่มีอยู่แล้ว) เพื่อดูว่า Event ไหน active อยู่บ้าง */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => navigation.navigate('ShopEvents', { shopId })}
            >
              <LinearGradient colors={[colors.primary, vendorAccent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View>
                    <Text style={styles.heroLabel}>มูลค่าส่วนลดสะสม</Text>
                    <Text style={styles.heroValue}>
                      ฿{shop.summary.total_discount_baht.toLocaleString('th-TH')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
                </View>
                <Text style={styles.heroHint}>ส่วนลดที่ลูกค้าได้รับจากร้านคุณสะสม — ไม่ใช่ยอดเงินในบัญชี</Text>

                <View style={styles.heroDivider} />

                <View style={styles.statRow}>
                  <Stat value={shop.summary.events_active} label="Event ที่เปิดอยู่" />
                  <Stat value={shop.summary.tickets_issued} label="ตั๋วที่ออกแล้ว" />
                  <Stat value={shop.summary.tickets_redeemed} label="ใช้ไปแล้ว" />
                </View>
                <Text style={styles.heroFooterHint}>Event ทั้งหมด {shop.summary.events_total} รายการ · แตะเพื่อดู Event ที่เปิดอยู่</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* โควตาคือ revenue model จริงของแพลตฟอร์ม (ร้านซื้อแพ็กเกจรายเดือน) จึงจัดให้เด่นเป็น
                อันดับ 2 รองจากมูลค่าส่วนลด — เตือนด้วยกรอบสีส้มเมื่อโควตาใกล้หมด/หมดแล้ว */}
            {quota && (
              <View
                style={[
                  styles.quotaCard,
                  (quota.event_balance === 0 || quota.ticket_balance === 0) && styles.quotaCardWarn,
                ]}
              >
                <View style={styles.quotaHead}>
                  <Text style={styles.quotaTitle}>โควตา · {quota.package.name}</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('PurchaseHistory')} hitSlop={8}>
                    <Text style={styles.quotaLink}>ประวัติการซื้อ</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.statRow}>
                  <Stat value={quota.ticket_balance} label="ตั๋วคงเหลือ" />
                  <Stat value={quota.event_balance} label="สร้าง Event ได้อีก" />
                  <Stat value={quota.ticket_per_event} label="เพดานตั๋ว/Event" />
                </View>

                {quota.event_balance === 0 && (
                  <Text style={styles.quotaWarn}>โควตา Event หมดแล้ว — ซื้อเพิ่มหรืออัปเกรดก่อนจึงจะสร้าง Event ใหม่ได้</Text>
                )}

                <View style={styles.quotaActions}>
                  <TouchableOpacity style={styles.quotaButton} onPress={() => navigation.navigate('Packages')}>
                    <Ionicons name="albums-outline" size={16} color={colors.primary} />
                    <Text style={styles.quotaButtonText}>แพ็กเกจ</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quotaButton, !quota.package.topup_enabled && styles.quotaButtonMuted]}
                    onPress={() => navigation.navigate('Topup')}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={16}
                      color={quota.package.topup_enabled ? colors.primary : colors.textMuted}
                    />
                    <Text
                      style={[styles.quotaButtonText, !quota.package.topup_enabled && styles.quotaButtonTextMuted]}
                    >
                      ซื้อโควตาเพิ่ม
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {hotEvent && (() => {
              const pct = hotEvent.tickets_issued > 0
                ? Math.round((hotEvent.tickets_redeemed / hotEvent.tickets_issued) * 100)
                : 0;
              const topProduct = hotEvent.product_breakdown[0];
              return (
                <TouchableOpacity
                  style={styles.hotCard}
                  onPress={() => navigation.navigate('EventCompare', { shopId })}
                  activeOpacity={0.85}
                >
                  <View style={styles.hotCardHead}>
                    <View style={styles.hitTag}>
                      <Ionicons name="flame" size={14} color="#fff" />
                      <Text style={styles.hitTagText}>Event ที่กำลังฮิต</Text>
                    </View>
                    <View style={styles.hotCardStatusPill}>
                      <Text style={styles.hotCardStatusPillText}>กำลังใช้งาน</Text>
                    </View>
                  </View>

                  <View style={styles.hotCardInner}>
                    <View style={styles.hotCardInnerHead}>
                      <Text style={styles.hotCardTitle} numberOfLines={1}>{hotEvent.title}</Text>
                      <Text style={styles.hotCardCount}>{hotEvent.tickets_redeemed}/{hotEvent.tickets_issued} ใบ</Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${pct}%` }]} />
                    </View>
                    <View style={styles.progressCaption}>
                      <Text style={styles.progressCaptionText}>ใช้สิทธิ์แล้ว {hotEvent.tickets_redeemed} จาก {hotEvent.tickets_issued} ใบ</Text>
                      <Text style={styles.progressCaptionPct}>{pct}%</Text>
                    </View>
                  </View>

                  {topProduct && (
                    <View style={styles.hotCardFooter}>
                      <Ionicons name="basket-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.hotCardFooterText} numberOfLines={1}>
                        สินค้าขายดี: <Text style={styles.hotCardFooterStrong}>{topProduct.product_name}</Text> ({topProduct.redeemed_count} ครั้ง)
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })()}

            <View style={styles.quickSection}>
              <Text style={styles.quickSectionLabel}>การจัดการด่วน</Text>
              <View style={styles.quickActionsGrid}>
                <QuickAction
                  icon="scan-outline"
                  label="สแกน QR"
                  onPress={() => navigation.navigate('Scanner', {})}
                />
                <QuickAction
                  icon="add-circle-outline"
                  label="สร้าง Event ใหม่"
                  onPress={() => navigation.navigate('EventForm', { shopId })}
                />
                <QuickAction
                  icon="cube-outline"
                  label="จัดการสินค้า"
                  onPress={() => navigation.navigate('ShopProducts', { shopId })}
                />
                <QuickAction
                  icon="people-outline"
                  label="จัดการพนักงาน"
                  onPress={() => navigation.navigate('StaffManagement', { shopId })}
                />
              </View>
            </View>
          </>
        ) : (
          !error && <LoadingView label="กำลังโหลดข้อมูลร้าน..." />
        )}
      </ScrollView>

      <BottomTabBar active="ShopDashboard" navigation={navigation} />
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.quickActionIconBadge}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.quickActionLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },

  // Native header (title + avatar) — ย้ายมาจากในการ์ดตามที่ขอ
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.primary },
  headerSubtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  headerSubtitle: { fontSize: 11, color: colors.textMuted, maxWidth: 160 },
  headerAvatarButton: { marginRight: spacing.xs },
  headerAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft },
  headerAvatarPlaceholder: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatarText: { color: colors.primary, fontWeight: '800', fontSize: 14 },

  // การ์ดหลัก — มูลค่าส่วนลดสะสม + สรุปของร้าน รวมเป็นการ์ดเดียว แตะได้ทั้งการ์ด
  heroCard: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm, ...shadows.card },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5 },
  heroValue: { fontSize: 32, fontWeight: '800', color: '#fff' },
  heroHint: { fontSize: 11, color: 'rgba(255,255,255,0.8)' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 2 },
  heroFooterHint: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },

  // "Event ที่กำลังฮิต" — ตกแต่งใหม่ตาม mockup: badge สถานะ, กล่องความคืบหน้า, สินค้าขายดี
  hotCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  hotCardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hitTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.dealAccent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  hitTagText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  hotCardStatusPill: {
    backgroundColor: colors.primaryPill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  hotCardStatusPillText: { fontSize: 11, fontWeight: '700', color: colors.primaryPillText },
  hotCardInner: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hotCardInnerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hotCardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1, marginRight: spacing.sm },
  hotCardCount: { fontSize: 13, fontWeight: '700', color: colors.primary },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },
  progressCaption: { flexDirection: 'row', justifyContent: 'space-between' },
  progressCaptionText: { fontSize: 11, color: colors.textMuted },
  progressCaptionPct: { fontSize: 11, fontWeight: '700', color: colors.primary },
  hotCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hotCardFooterText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  hotCardFooterStrong: { color: colors.text, fontWeight: '700' },

  // การจัดการด่วน — แถวเดียว 4 ปุ่ม พร้อมป้ายหมวดหมู่กำกับ ตาม mockup
  quickSection: { gap: spacing.sm },
  quickSectionLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 2 },
  quickActionsGrid: { flexDirection: 'row', gap: spacing.sm },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  quickActionIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: { fontSize: 12.5, fontWeight: '600', color: colors.text, textAlign: 'center' },

  quotaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    ...shadows.card,
  },
  quotaCardWarn: { borderColor: colors.warning, backgroundColor: colors.warningBg },
  quotaHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quotaTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  quotaLink: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  quotaWarn: { fontSize: 12, color: colors.warning },
  quotaActions: { flexDirection: 'row', gap: spacing.sm },
  quotaButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  quotaButtonMuted: { opacity: 0.6 },
  quotaButtonText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  quotaButtonTextMuted: { color: colors.textMuted },
  statRow: { flexDirection: 'row', gap: spacing.sm },
});
