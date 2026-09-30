import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { formatIsoDateTime } from '../utils/datetime';
import { useRequireMode } from '../hooks/useRequireMode';
import { useColors } from '../hooks/useColors';
import { colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffToday'>;

type RedemptionItem = {
  id: string;
  event_title: string;
  discount_value_baht: string; // Prisma Decimal serialises as a string
  redeemed_at: string;
};

export default function StaffTodayScreen({ navigation }: Props) {
  // owners scan too, so this is reachable from vendor mode as well as staff mode — สีต้อง
  // อ่านตามโหมดจริง (vendor=น้ำเงิน, staff=เขียว) ไม่ hardcode
  useRequireMode(['vendor', 'staff'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }));
  const c = useColors();
  const [items, setItems] = useState<RedemptionItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<RedemptionItem[]>('/v1/staff/redemptions/today');
      setItems(data);
      setError(null);
    } catch {
      setError('โหลดสรุปวันนี้ไม่สำเร็จ');
    }
  }, []);

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

  const total = items.reduce((sum, r) => sum + Number(r.discount_value_baht), 0);

  return (
    <View style={styles.container}>
      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>สแกนทั้งหมดวันนี้</Text>
          <Text style={[styles.statValue, { color: c.primary }]}>{items.length}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>ยอดส่วนลดรวม (บาท)</Text>
          <Text style={[styles.statValue, { color: c.primary }]}>{total.toLocaleString('th-TH')}</Text>
        </View>
      </View>
      <Text style={styles.note}>นับเฉพาะที่บัญชีนี้สแกนเอง · ตัดวันตามเวลาประเทศไทย</Text>

      <ErrorBanner message={error} />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>วันนี้ยังไม่มีการสแกน</Text>}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={[styles.cardIconBubble, { backgroundColor: c.primaryPill }]}>
              <Ionicons name="ticket-outline" size={20} color={c.primary} />
            </View>
            <View style={styles.cardTextWrap}>
              <Text style={styles.cardTitle}>{item.event_title}</Text>
              <Text style={styles.cardTime}>{formatIsoDateTime(item.redeemed_at)}</Text>
            </View>
            <Text style={[styles.cardDiscount, { color: c.primary }]}>ลด {item.discount_value_baht} บาท</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  statRow: { flexDirection: 'row', gap: spacing.sm, margin: spacing.md, marginBottom: 0 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },
  statLabel: { fontSize: 12, color: colors.textMuted },
  statValue: { fontSize: 28, fontWeight: '800' },
  note: { fontSize: 11, color: colors.textMuted, marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: 15 },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    ...shadows.card,
  },
  cardIconBubble: {
    width: 48, height: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTextWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardTime: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cardDiscount: { fontSize: 13, fontWeight: '600' },
});
