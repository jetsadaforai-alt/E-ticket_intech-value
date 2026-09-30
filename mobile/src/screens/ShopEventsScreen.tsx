import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import BottomTabBar from '../components/BottomTabBar';
import { ErrorBanner } from '../components/ErrorBanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { useMode } from '../context/ModeContext';
import { useRequireMode } from '../hooks/useRequireMode';
import { useColors } from '../hooks/useColors';
import { formatIsoDateOnly } from '../utils/datetime';
import { colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShopEvents'>;

type EventItem = {
  id: string;
  title: string;
  status: string;
  startTime: string;
  endTime: string;
  ticketBatch: { totalQty: number; remainingCount: number } | null;
  // Set once this event has already been relaunched — see the "เปิดใหม่" button below.
  relaunchedToEventId: string | null;
  relaunchedTo: { id: string; title: string } | null;
};

const STATUS_TH: Record<string, string> = {
  active: 'เปิดอยู่',
  expired: 'หมดเวลา',
  cancelled: 'ยกเลิกแล้ว',
  banned: 'ถูกระงับ',
};
const STATUS_COLOR: Record<string, string> = {
  active: colors.success,
  expired: colors.textMuted,
  cancelled: colors.danger,
  banned: colors.danger,
};
// การ์ดที่เหลือในแอปใช้ badge สีพื้นทึบแบบนี้กันหมด (CouponCardHeader/EventCard/WalletScreen)
// หน้านี้เดิมมีแค่ตัวหนังสือสีเปล่าๆ ไม่มีพื้นกำกับเลย
const STATUS_BG: Record<string, string> = {
  active: '#E6F5EA',
  expired: colors.neutralBubble,
  cancelled: colors.dangerBg,
  banned: colors.dangerBg,
};

// ลำดับ + ป้ายของ pill กรองสถานะด้านบนลิสต์ — โชว์เฉพาะ pill ที่มี event จริงอยู่ในสถานะนั้น
// (ไม่โชว์ pill เปล่าๆ) ตาม mockup "Event ของร้าน - พร้อม Dropdown ดูสถิติและสินค้าแลก"
const FILTER_DEFS: { key: string; label: string }[] = [
  { key: 'active', label: 'เปิดอยู่' },
  { key: 'expired', label: 'หมดเวลา' },
  { key: 'cancelled', label: 'ยกเลิกแล้ว' },
  { key: 'banned', label: 'ถูกระงับ' },
];

function daysLeftLabel(endTimeIso: string): string | null {
  const diffMs = new Date(endTimeIso).getTime() - Date.now();
  if (diffMs <= 0) return null;
  const days = Math.ceil(diffMs / 86400000);
  return days <= 1 ? 'หมดเขตวันนี้' : `เหลืออีก ${days} วัน`;
}

export default function ShopEventsScreen({ route, navigation }: Props) {
  const { shopId } = route.params;
  const { mode } = useMode();
  useRequireMode(['vendor', 'staff'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), shopId);
  // หน้านี้เข้าได้ทั้งโหมด vendor (น้ำเงิน) และ staff (เขียว) — ต่างจาก EventFormScreen/
  // ShopProductsScreen ที่ใช้ vendorColors แบบ static ได้เพราะเข้าได้แค่โหมดเดียว ที่นี่ต้อง
  // อ่านสีตามโหมดจริง (มีผลแค่จุดที่ใช้ primary — ค่าอื่นเหมือนกันทั้งสอง palette อยู่แล้ว)
  const c = useColors();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // staff may look but not touch — no create button, and tapping opens a read-only
  // view with a scan shortcut instead of the edit form.
  const canEdit = mode === 'vendor';

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<EventItem[]>(`/v1/shops/${shopId}/events`);
      setEvents(data);
      setError(null);
    } catch {
      setError('โหลดรายการ Event ไม่สำเร็จ');
    }
  }, [shopId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // หัวข้อจอ — เดิมมีแค่ชื่อจอนิ่งๆ ตอนนี้ใส่จำนวน Event ทั้งหมดกำกับข้างชื่อ + subtitle
  // อธิบายหน้าที่ของจอ ตาม mockup
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitleText}>Event ของร้าน</Text>
            <View style={[styles.headerCountBadge, { backgroundColor: c.primarySoft }]}>
              <Text style={[styles.headerCountBadgeText, { color: c.primary }]}>{events.length} รายการ</Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>จัดการโปรโมชันและบัตรส่วนลด</Text>
        </View>
      ),
    });
  }, [navigation, events.length, c.primary, c.primarySoft]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openEvent = (eventId: string) => {
    if (canEdit) navigation.navigate('EventForm', { shopId, eventId });
    else navigation.navigate('ShopEventView', { eventId });
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    events.forEach((e) => {
      map[e.status] = (map[e.status] ?? 0) + 1;
    });
    return map;
  }, [events]);

  const availableFilters = FILTER_DEFS.filter((f) => (counts[f.key] ?? 0) > 0);
  const filteredEvents = activeFilter ? events.filter((e) => e.status === activeFilter) : events;

  return (
    <View style={styles.container}>
      {canEdit && (
        <View style={styles.actions}>
          <PrimaryButton title="+ สร้าง Event" onPress={() => navigation.navigate('EventForm', { shopId })} />
        </View>
      )}

      <ErrorBanner message={error} />

      {events.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
        >
          <TouchableOpacity
            style={[styles.filterPill, !activeFilter && { backgroundColor: c.primary, borderColor: c.primary }]}
            onPress={() => setActiveFilter(null)}
          >
            <Text style={[styles.filterPillText, !activeFilter && styles.filterPillTextActive]}>
              ทั้งหมด {events.length}
            </Text>
          </TouchableOpacity>
          {availableFilters.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterPill,
                activeFilter === f.key && { backgroundColor: c.primary, borderColor: c.primary },
              ]}
              onPress={() => setActiveFilter(f.key)}
            >
              <Text style={[styles.filterPillText, activeFilter === f.key && styles.filterPillTextActive]}>
                {f.label} {counts[f.key]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={filteredEvents}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {events.length > 0
              ? 'ไม่มี Event ในหมวดนี้'
              : canEdit
                ? 'ยังไม่มี Event — กด "+ สร้าง Event" เพื่อเริ่ม'
                : 'ร้านนี้ยังไม่มี Event'}
          </Text>
        }
        contentContainerStyle={filteredEvents.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => {
          const isActive = item.status === 'active';
          const total = item.ticketBatch?.totalQty ?? 0;
          const remaining = item.ticketBatch?.remainingCount ?? 0;
          const used = total - remaining;
          const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
          const daysLeft = isActive ? daysLeftLabel(item.endTime) : null;
          // Relaunch is only meaningful once an event has actually ended — a banned
          // event's slot was lost to moderation, not freed up for reuse (matches the
          // backend's own NOT_ENDED rule on POST /v1/events/:id/relaunch). Already having
          // a successor also rules it out — tapping "เปิดใหม่" again would fork a second,
          // disconnected copy of the same promotion instead of pointing back at the one
          // that already exists.
          const canRelaunch =
            canEdit && (item.status === 'expired' || item.status === 'cancelled') && !item.relaunchedToEventId;

          return (
            <TouchableOpacity style={styles.cardWrap} onPress={() => openEvent(item.id)} activeOpacity={0.85}>
              <View style={styles.cardRow}>
                {isActive && <View style={[styles.accentBar, { backgroundColor: c.primary }]} />}
                <View style={styles.cardBody}>
                  <View style={styles.cardHeadRow}>
                    <View style={styles.cardHeadLeft}>
                      <View style={[styles.statusBadge, { backgroundColor: STATUS_BG[item.status] ?? colors.neutralBubble }]}>
                        {isActive && <View style={styles.pulseDot} />}
                        <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? colors.textMuted }]}>
                          {STATUS_TH[item.status] ?? item.status}
                        </Text>
                      </View>
                      {daysLeft && <Text style={styles.daysLeftText}>{daysLeft}</Text>}
                    </View>
                    <View style={styles.quotaPill}>
                      <Text style={styles.quotaPillText}>
                        เหลือ {remaining}/{total}
                        {!isActive && used > 0 ? ` (ใช้แล้ว ${used})` : ''}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.cardDateRange}>
                    {formatIsoDateOnly(item.startTime)} - {formatIsoDateOnly(item.endTime)}
                  </Text>

                  {isActive && total > 0 && (
                    <View style={styles.progressWrap}>
                      <View style={styles.progressLabelRow}>
                        <Text style={styles.progressLabel}>โควตาคงเหลือ</Text>
                        <Text style={styles.progressPct}>{pct}%</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${pct}%`, backgroundColor: pct <= 20 ? colors.warning : colors.success },
                          ]}
                        />
                      </View>
                    </View>
                  )}

                  {(canRelaunch || item.relaunchedTo) && (
                    <View style={styles.cardFooterRow}>
                      {canRelaunch && (
                        <TouchableOpacity
                          style={[styles.relaunchButton, { borderColor: c.primary, backgroundColor: c.primarySoft }]}
                          onPress={(e) => {
                            e.stopPropagation();
                            navigation.navigate('EventForm', { shopId, cloneFromEventId: item.id });
                          }}
                        >
                          <Ionicons name="refresh" size={13} color={c.primary} />
                          <Text style={[styles.relaunchButtonText, { color: c.primary }]}>เปิดใหม่</Text>
                        </TouchableOpacity>
                      )}
                      {item.relaunchedTo && (
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            openEvent(item.relaunchedTo!.id);
                          }}
                          hitSlop={4}
                        >
                          <Text style={styles.relaunchedText} numberOfLines={1}>
                            เปิดใหม่แล้ว: {item.relaunchedTo.title}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <BottomTabBar active="ShopEvents" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  actions: { padding: spacing.md, paddingBottom: spacing.sm },

  headerTitleWrap: { alignItems: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerTitleText: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerCountBadge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  headerCountBadgeText: { fontSize: 11, fontWeight: '700' },
  headerSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

  filterRow: { flexGrow: 0, paddingLeft: spacing.md },
  filterRowContent: { gap: spacing.xs, paddingRight: spacing.md, paddingBottom: spacing.sm },
  filterPill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  filterPillText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  filterPillTextActive: { color: '#fff' },

  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: 15, paddingHorizontal: 24 },
  emptyContainer: { flex: 1, justifyContent: 'center' },

  cardWrap: { borderRadius: radius.md, ...shadows.card },
  cardRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  accentBar: { width: 4 },
  cardBody: { flex: 1, padding: spacing.md, gap: 6 },

  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  status: { fontSize: 12, fontWeight: '700' },
  daysLeftText: { fontSize: 11, color: colors.textMuted },
  quotaPill: {
    backgroundColor: colors.neutralBubble,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  quotaPillText: { fontSize: 11, fontWeight: '700', color: colors.text },

  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 2 },
  cardDateRange: { fontSize: 12, color: colors.textMuted },

  progressWrap: { marginTop: 4, gap: 4 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  progressPct: { fontSize: 11, color: colors.text, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.neutralBubble, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  relaunchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  relaunchButtonText: { fontSize: 12, fontWeight: '700' },
  relaunchedText: { fontSize: 11, color: colors.textMuted, maxWidth: 160, textAlign: 'right' },
});
