import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { ApiError } from '../api/client';
import { createPurchase, getQuota, type Quota } from '../api/quota';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ConfirmPurchase'>;

/**
 * Sits between "tap to buy" and the real charge — Cancel here never calls
 * createPurchase(), so an abandoned tap leaves no Purchase/Payment row behind
 * (unlike abandoning the Payment screen itself, which still does — a known,
 * separately-tracked gap).
 */
export default function ConfirmPurchaseScreen({ route, navigation }: Props) {
  const { request, title, priceBaht, resultSummary, quotaPreview } = route.params;
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getQuota()
      .then(setQuota)
      .catch(() => setError('โหลดข้อมูลโควตาไม่สำเร็จ'));
  }, []);

  if (!quota && !error) return <LoadingView label="กำลังโหลด..." />;

  const onConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const { purchase, payment } = await createPurchase(request);
      navigation.replace('Payment', { purchaseId: purchase.id, payment, summary: resultSummary });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เริ่มการซื้อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ErrorBanner message={error} />

      <Text style={styles.summary}>{title}</Text>
      <Text style={styles.amount}>{priceBaht.toLocaleString('th-TH')} ฿</Text>

      {quota && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>การเปลี่ยนแปลงโควตา</Text>

          {quotaPreview.targetEventTitle ? (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Event "{quotaPreview.targetEventTitle}"</Text>
              <Text style={styles.statValue}>+{quotaPreview.ticketDelta} ใบ</Text>
            </View>
          ) : (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>กองตั๋ว</Text>
              <Text style={styles.statValue}>
                {quota.ticket_balance} → {quota.ticket_balance + quotaPreview.ticketDelta} ใบ
              </Text>
            </View>
          )}

          {quotaPreview.eventDelta > 0 && (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>สิทธิ์สร้าง Event</Text>
              <Text style={styles.statValue}>
                {quota.event_balance} → {quota.event_balance + quotaPreview.eventDelta} ครั้ง
              </Text>
            </View>
          )}

          {quotaPreview.newTicketPerEvent !== undefined && (
            <View style={[styles.statRow, styles.statRowLast]}>
              <Text style={styles.statLabel}>เพดานตั๋ว/Event</Text>
              <Text style={styles.statValue}>
                {quota.ticket_per_event} → {quotaPreview.newTicketPerEvent} ใบ
              </Text>
            </View>
          )}
        </View>
      )}

      <PrimaryButton title="ยืนยัน" loading={busy} onPress={onConfirm} />
      <PrimaryButton title="ยกเลิก" variant="secondary" onPress={() => navigation.goBack()} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, alignItems: 'center', paddingBottom: spacing.xl },
  summary: { fontSize: 15, color: colors.text, textAlign: 'center' },
  amount: { fontSize: 34, fontWeight: '800', color: colors.primary },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statRowLast: { borderBottomWidth: 0 },
  statLabel: { fontSize: 13, color: colors.textMuted },
  statValue: { fontSize: 13, fontWeight: '700', color: colors.text },
});
