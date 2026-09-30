import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { Stat } from '../components/Stat';
import { useRequireMode } from '../hooks/useRequireMode';
import { formatIsoDateTime } from '../utils/datetime';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EventCompare'>;

type ProductBreakdownRow = { product_id: string; product_name: string; redeemed_count: number };
type SubstitutionRow = { out_of_stock_product_name: string; substitute_product_name: string; created_at: string };

type CompareRow = {
  id: string;
  title: string;
  status: string;
  start_time: string;
  end_time: string;
  tickets_issued: number;
  tickets_redeemed: number;
  discount_paid_baht: number;
  product_breakdown: ProductBreakdownRow[];
  out_of_stock_count: number;
  unspecified_count: number;
  substitutions: SubstitutionRow[];
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

/**
 * Lets a vendor see, per event, how it actually performed — not just issued/redeemed
 * counts but which of the event's products customers actually chose — so they can judge
 * which promotion worked before deciding what to relaunch (see ShopEventsScreen's reset
 * button). Sorted by tickets_redeemed by the backend; detail per event expands in place
 * rather than opening a second screen, since the list itself is usually short.
 */
export default function EventCompareScreen({ route, navigation }: Props) {
  const { shopId } = route.params;
  useRequireMode(['vendor'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), shopId);

  const [rows, setRows] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<CompareRow[]>(`/v1/shops/${shopId}/events/compare`);
      setRows(data);
      setError(null);
    } catch {
      setError('โหลดข้อมูลเปรียบเทียบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) return <LoadingView label="กำลังโหลดข้อมูลเปรียบเทียบ..." />;

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.listContent}
        ListHeaderComponent={
          rows.length > 0 ? (
            <View style={styles.headerWrap}>
              <ErrorBanner message={error} />
              <Text style={styles.intro}>
                เรียงจาก Event ที่มีคนใช้สิทธิ์เยอะสุด — แตะการ์ดเพื่อดูว่าลูกค้าเลือกสินค้าอะไรบ้าง
              </Text>
            </View>
          ) : (
            <ErrorBanner message={error} />
          )
        }
        ListEmptyComponent={<Text style={styles.empty}>ร้านนี้ยังไม่มี Event ให้เปรียบเทียบ</Text>}
        renderItem={({ item, index }) => {
          const expanded = expandedId === item.id;
          const hasBreakdown =
            item.product_breakdown.length > 0 || item.out_of_stock_count > 0 || item.unspecified_count > 0;
          // Backend already sorts by tickets_redeemed — the first card with any real usage
          // at all is the actual "hit" of the shop, not just alphabetically or by date first.
          const isTopPerformer = index === 0 && item.tickets_redeemed > 0;
          const sortedBreakdown = item.product_breakdown.slice().sort((a, b) => b.redeemed_count - a.redeemed_count);
          const maxBreakdownCount = Math.max(1, ...sortedBreakdown.map((p) => p.redeemed_count));
          return (
            <TouchableOpacity
              style={[styles.card, isTopPerformer && styles.cardTop]}
              onPress={() => setExpandedId(expanded ? null : item.id)}
              activeOpacity={0.85}
            >
              <View style={styles.cardHead}>
                <View style={styles.cardTextWrap}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {isTopPerformer && (
                      <View style={styles.hitTag}>
                        <Text style={styles.hitTagText}>ฮิตสุด</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardSub}>
                    {formatIsoDateTime(item.start_time)} - {formatIsoDateTime(item.end_time)}
                  </Text>
                </View>
                <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? colors.textMuted }]}>
                  {STATUS_TH[item.status] ?? item.status}
                </Text>
              </View>

              <View style={styles.statRow}>
                <Stat value={item.tickets_issued} label="ตั๋วที่ออก" />
                <Stat value={item.tickets_redeemed} label="ใช้สิทธิ์แล้ว" />
                <Stat value={`฿${item.discount_paid_baht.toLocaleString('th-TH')}`} label="ส่วนลดที่จ่ายไป" />
              </View>

              {hasBreakdown && (
                <View style={styles.expandToggle}>
                  <Text style={styles.expandToggleText}>
                    {expanded ? 'ซ่อนรายละเอียดสินค้า' : 'ดูรายละเอียดสินค้า'}
                  </Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.primary}
                  />
                </View>
              )}

              {expanded && (
                <View style={styles.detailBox}>
                  {item.product_breakdown.length === 0 && item.out_of_stock_count === 0 && item.unspecified_count === 0 ? (
                    <Text style={styles.detailEmpty}>ยังไม่มีข้อมูลสินค้าที่เลือก</Text>
                  ) : (
                    <>
                      {sortedBreakdown.map((p, i) => (
                        <View key={p.product_id} style={styles.barRow}>
                          <View style={styles.barLabelLine}>
                            <Text style={styles.barName} numberOfLines={1}>
                              {i === 0 ? '\u{1F451} ' : ''}
                              {p.product_name}
                            </Text>
                            <Text style={styles.barCount}>{p.redeemed_count} ครั้ง</Text>
                          </View>
                          <View style={styles.barTrack}>
                            <View
                              style={[
                                styles.barFill,
                                i === 0 && styles.barFillLeader,
                                { width: `${(p.redeemed_count / maxBreakdownCount) * 100}%` },
                              ]}
                            />
                          </View>
                        </View>
                      ))}
                      {item.out_of_stock_count > 0 && (
                        <View style={styles.detailRow}>
                          <Text style={[styles.detailName, styles.detailWarn]}>สินค้าหมด</Text>
                          <Text style={[styles.detailCount, styles.detailWarn]}>{item.out_of_stock_count} ครั้ง</Text>
                        </View>
                      )}
                      {item.unspecified_count > 0 && (
                        <View style={styles.detailRow}>
                          <Text style={[styles.detailName, styles.detailMuted]}>ไม่ระบุ</Text>
                          <Text style={[styles.detailCount, styles.detailMuted]}>{item.unspecified_count} ครั้ง</Text>
                        </View>
                      )}
                    </>
                  )}

                  {item.substitutions.length > 0 && (
                    <View style={styles.substituteHistory}>
                      <Text style={styles.substituteHistoryTitle}>ประวัติสินค้าทดแทน</Text>
                      {item.substitutions.map((s, i) => (
                        <Text key={i} style={styles.substituteHistoryRow}>
                          {s.out_of_stock_product_name} → {s.substitute_product_name}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerWrap: { gap: spacing.xs, marginBottom: spacing.xs },
  intro: { fontSize: 13, color: colors.textMuted, lineHeight: 20 },
  listContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: 15, paddingHorizontal: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  cardTop: { borderWidth: 2, borderColor: colors.primaryPill },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  hitTag: {
    backgroundColor: colors.dealAccent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexShrink: 0,
  },
  hitTagText: { fontSize: 10.5, fontWeight: '700', color: '#fff' },

  cardTextWrap: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  status: { fontSize: 12, fontWeight: '600' },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  expandToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  expandToggleText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  detailBox: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 6,
  },
  detailEmpty: { fontSize: 12, color: colors.textMuted },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  barRow: { gap: 3 },
  barLabelLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  barName: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  barCount: { fontSize: 13, fontWeight: '700', color: colors.text },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.neutralBubble, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  barFillLeader: { backgroundColor: colors.primaryDark },

  detailName: { fontSize: 13, color: colors.text, flex: 1, marginRight: spacing.sm },
  detailCount: { fontSize: 13, color: colors.text, fontWeight: '600' },
  detailWarn: { color: colors.danger },
  detailMuted: { color: colors.textMuted },
  substituteHistory: { marginTop: spacing.xs, gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
  substituteHistoryTitle: { fontSize: 12, fontWeight: '700', color: colors.text },
  substituteHistoryRow: { fontSize: 12, color: colors.textMuted },
});
