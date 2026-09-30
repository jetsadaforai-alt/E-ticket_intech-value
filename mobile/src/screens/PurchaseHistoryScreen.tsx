import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { listPurchases, type Purchase } from '../api/quota';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { formatIsoDateTime } from '../utils/datetime';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseHistory'>;

const TYPE_TH: Record<string, string> = {
  package: 'ซื้อแพ็กเกจ',
  event_topup: 'ซื้อ Event เพิ่ม',
  ticket_topup: 'ซื้อตั๋วเพิ่ม',
};

const STATUS_TH: Record<string, string> = {
  pending: 'รอชำระเงิน',
  paid: 'ชำระแล้ว',
  failed: 'ไม่สำเร็จ',
  cancelled: 'ยกเลิก',
};

const STATUS_COLOR: Record<string, string> = {
  pending: colors.warning,
  paid: colors.success,
  failed: colors.danger,
  cancelled: colors.textMuted,
};

export default function PurchaseHistoryScreen(_props: Props) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPurchases(await listPurchases());
      setError(null);
    } catch {
      setError('โหลดประวัติการซื้อไม่สำเร็จ');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!purchases && !error) return <LoadingView label="กำลังโหลดประวัติ..." />;

  return (
    <View style={styles.container}>
      <ErrorBanner message={error} />
      <FlatList
        data={purchases ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={<Text style={styles.empty}>ยังไม่มีประวัติการซื้อ</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.headRow}>
              <Text style={styles.type}>{TYPE_TH[item.type] ?? item.type}</Text>
              <Text style={styles.amount}>{item.amount_baht.toLocaleString('th-TH')} ฿</Text>
            </View>

            <Text style={styles.detail}>
              แพ็กเกจ {item.package_code}
              {item.quantity > 1 ? ` · ${item.quantity} ชุด` : ''}
            </Text>
            <Text style={styles.detail}>
              ได้ตั๋ว {item.tickets_added} ใบ
              {item.events_added > 0 ? ` · Event ${item.events_added} ครั้ง` : ''}
            </Text>

            <View style={styles.footRow}>
              <Text style={styles.date}>{formatIsoDateTime(item.paid_at ?? item.created_at)}</Text>
              <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? colors.textMuted }]}>
                {STATUS_TH[item.status] ?? item.status}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: 2,
    ...shadows.card,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { fontSize: 15, fontWeight: '700', color: colors.text },
  amount: { fontSize: 15, fontWeight: '800', color: colors.primary },
  detail: { fontSize: 12, color: colors.textMuted },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  date: { fontSize: 11, color: colors.textMuted },
  status: { fontSize: 11, fontWeight: '700' },
});
