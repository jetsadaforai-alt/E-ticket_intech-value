import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, TouchableOpacity, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import BottomTabBar from '../components/BottomTabBar';
import { NotchCard } from '../components/NotchCard';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { SkeletonList } from '../components/Skeleton';
import { CouponCardHeader, type BadgeTone } from '../components/CouponCardHeader';
import { formatDiscountBadge } from '../api/products';
import { formatIsoDateOnly } from '../utils/datetime';
import { colors, radius, spacing, touch, type } from '../theme';

// Height of the header block (event photo + shop-avatar row) that the notch sits below —
// keeps the notch aligned on cardDivider regardless of how long the footer content runs.
// 140 (CouponCardHeader's imageHeight here) + 21 (its headRow paddingTop) + 40 (avatar
// diameter, the row's tallest element) + 8 (its headRow paddingBottom) — see
// components/CouponCardHeader.tsx's fixed style values.
const NOTCH_OFFSET_PX = 140 + 21 + 40 + 8;

type Props = NativeStackScreenProps<RootStackParamList, 'Wallet'>;

type TicketListItem = {
  id: string;
  code: string;
  status: string;
  event_title: string;
  shop_name: string;
  shop_logo_url: string | null;
  discount_value_baht: string;
  discount_min_baht: number;
  discount_max_baht: number;
  issued_at: string;
  thumbnail_url: string | null;
};

// Three tabs instead of two — used vs expired/cancelled used to share one tab and one
// grey badge. Still split client-side from the single GET /v1/tickets/me response.
type Tab = 'available' | 'used' | 'expired';

const TABS: { key: Tab; label: string }[] = [
  { key: 'available', label: 'ใช้ได้' },
  { key: 'used', label: 'ใช้แล้ว' },
  { key: 'expired', label: 'หมดอายุ·ยกเลิก' },
];

function tabOf(status: string): Tab {
  if (status === 'ISSUED') return 'available';
  if (status === 'REDEEMED') return 'used';
  return 'expired'; // EXPIRED, CANCELLED
}

const STATUS_TH: Record<string, string> = {
  ISSUED: 'พร้อมใช้',
  REDEEMED: 'ใช้แล้ว',
  CANCELLED: 'ถูกยกเลิก',
  EXPIRED: 'หมดอายุ',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  ISSUED: 'success',
  REDEEMED: 'muted',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
};

const EMPTY: Record<Tab, { icon: keyof typeof Ionicons.glyphMap; title: string; hint: string }> = {
  available: {
    icon: 'ticket-outline',
    title: 'ยังไม่มีตั๋วที่ใช้ได้',
    hint: 'รับตั๋วส่วนลดจากร้านที่คุณชอบได้ที่หน้าแรก',
  },
  used: { icon: 'checkmark-done-outline', title: 'ยังไม่มีตั๋วที่ใช้แล้ว', hint: 'ตั๋วที่สแกนใช้สิทธิ์แล้วจะแสดงที่นี่' },
  expired: {
    icon: 'time-outline',
    title: 'ไม่มีตั๋วที่หมดอายุหรือถูกยกเลิก',
    hint: 'ตั๋วที่เลยเวลาของ Event หรือถูกยกเลิกจะแสดงที่นี่',
  },
};

export default function WalletScreen({ navigation }: Props) {
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [tab, setTab] = useState<Tab>('available');
  const [loading, setLoading] = useState(true); // ครั้งแรกเท่านั้น — แยกจาก refreshing
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<TicketListItem[]>('/v1/tickets/me');
      setTickets(data);
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดตั๋วของคุณไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { available: 0, used: 0, expired: 0 };
    tickets.forEach((t) => (c[tabOf(t.status)] += 1));
    return c;
  }, [tickets]);

  const visible = useMemo(() => tickets.filter((t) => tabOf(t.status) === tab), [tickets, tab]);

  let body: React.ReactNode;
  if (loading) {
    body = <SkeletonList count={2} variant="card" />;
  } else if (error && tickets.length === 0) {
    body = (
      <View style={styles.errorWrap}>
        <ErrorBanner message={error} onRetry={load} />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
        ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={load} /> : null}
        ListEmptyComponent={
          <EmptyState
            icon={EMPTY[tab].icon}
            title={EMPTY[tab].title}
            hint={EMPTY[tab].hint}
            actionLabel={tab === 'available' ? 'ดู Event ทั้งหมด' : undefined}
            onAction={tab === 'available' ? () => navigation.replace('Home') : undefined}
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const inactive = item.status !== 'ISSUED';
          return (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => navigation.navigate('TicketDetail', { ticketId: item.id })}
              accessibilityRole="button"
              accessibilityLabel={`${item.event_title} ร้าน ${item.shop_name} สถานะ ${STATUS_TH[item.status] ?? item.status}`}
              style={inactive ? styles.inactiveCard : undefined}
            >
              <NotchCard notchAtPx={NOTCH_OFFSET_PX} notchBackgroundColor={colors.background} style={styles.card}>
                <CouponCardHeader
                  thumbnailUrl={item.thumbnail_url}
                  imageHeight={140}
                  title={item.event_title}
                  shopName={item.shop_name}
                  shopLogoUrl={item.shop_logo_url}
                  badge={{ text: STATUS_TH[item.status] ?? item.status, tone: STATUS_TONE[item.status] ?? 'muted' }}
                />
                <View style={styles.cardDivider} />
                <View style={styles.cardFooter}>
                  <View style={styles.footerLeft}>
                    <Text style={[styles.cardDiscount, inactive && styles.cardDiscountInactive]}>
                      {formatDiscountBadge(item.discount_min_baht, item.discount_max_baht)}
                    </Text>
                    <Text style={styles.cardMeta}>รับเมื่อ {formatIsoDateOnly(item.issued_at)}</Text>
                  </View>
                  <View style={styles.footerRight}>
                    <Text style={styles.cardCode}>{item.code}</Text>
                    {!inactive ? (
                      <View style={styles.openQr}>
                        <Ionicons name="qr-code-outline" size={14} color={colors.primary} />
                        <Text style={styles.openQrText}>แสดง QR</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </NotchCard>
            </TouchableOpacity>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('ClaimTicket')}
          accessibilityRole="button"
        >
          <Ionicons name="gift-outline" size={18} color={colors.primary} />
          <Text style={styles.actionText}>รับตั๋วที่เพื่อนแชร์มา</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('ShareHistory')}
          accessibilityRole="button"
        >
          <Ionicons name="time-outline" size={18} color={colors.primary} />
          <Text style={styles.actionText}>ประวัติการแชร์</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow} accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${t.label} ${counts[t.key]} ใบ`}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                {t.label}
              </Text>
              {!loading ? (
                <View style={[styles.countPill, active && styles.countPillActive]}>
                  <Text style={[styles.countText, active && styles.countTextActive]}>{counts[t.key]}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.flex}>{body}</View>
      <BottomTabBar active="Wallet" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: touch.min,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  actionText: { ...type.label, color: colors.primary, flexShrink: 1 },
  // Segmented control on a darker track, so it no longer blends into the page
  tabRow: {
    flexDirection: 'row',
    margin: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.pill,
    padding: 4,
  },
  tab: {
    flex: 1,
    minHeight: touch.min - 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
  },
  tabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabLabel: { ...type.label, color: colors.textMuted, flexShrink: 1 },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
  countPill: { minWidth: 20, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center' },
  countPillActive: { backgroundColor: colors.primaryPill },
  countText: { ...type.captionStrong, color: colors.textMuted },
  countTextActive: { color: colors.primaryPillText },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm, flexGrow: 1 },
  errorWrap: { padding: spacing.md },
  card: { borderRadius: radius.card },
  inactiveCard: { opacity: 0.78 },
  cardDivider: { borderTopWidth: 2, borderTopColor: colors.border, borderStyle: 'dashed' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  footerLeft: { flex: 1 },
  footerRight: { alignItems: 'flex-end', gap: 2 },
  cardDiscount: { ...type.bodyStrong, color: colors.primary },
  cardDiscountInactive: { color: colors.textMuted },
  cardMeta: { ...type.caption, color: colors.textMuted },
  cardCode: { ...type.caption, color: colors.textMuted, letterSpacing: 0.5 },
  openQr: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openQrText: { ...type.captionStrong, color: colors.primary },
});
