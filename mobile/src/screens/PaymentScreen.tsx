import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { confirmMockPayment, getPurchase, getQuota, type Purchase, type Quota } from '../api/quota';
import { ErrorBanner } from '../components/ErrorBanner';
import { PrimaryButton } from '../components/PrimaryButton';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Payment'>;

const POLL_INTERVAL_MS = 3000;

/**
 * Shows the charge and waits for it to settle.
 *
 * Quota is granted by the gateway's callback to the backend, never by this screen — so
 * the only thing to do here is poll until the purchase flips to `paid`. That also means
 * closing the app mid-payment loses nothing: the webhook still lands.
 */
export default function PaymentScreen({ route, navigation }: Props) {
  const { purchaseId, payment, summary } = route.params;
  const [status, setStatus] = useState<string>(payment.status);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);

  const check = useCallback(async () => {
    if (settled.current) return;
    try {
      const { purchase: p } = await getPurchase(purchaseId);
      setStatus(p.status);
      setPurchase(p);
      if (p.status === 'paid' || p.status === 'failed') settled.current = true;
    } catch {
      // Transient network trouble shouldn't wipe the QR off the screen — the next
      // tick tries again.
    }
  }, [purchaseId]);

  useEffect(() => {
    const timer = setInterval(check, POLL_INTERVAL_MS);
    check();
    return () => clearInterval(timer);
  }, [check]);

  // Quota only needs a fresh read once the purchase actually lands — the balances
  // shown here are what the webhook just wrote, not a live subscription.
  useEffect(() => {
    if (status === 'paid') {
      getQuota().then(setQuota).catch(() => setQuota(null));
    }
  }, [status]);

  const devConfirm = payment.payload?.dev_confirm;

  const onDevPay = async () => {
    if (!devConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await confirmMockPayment({ provider_ref: devConfirm.provider_ref, status: 'succeeded' });
      await check();
    } catch {
      setError('จำลองการชำระเงินไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'paid') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.resultScrollContent}>
        <View style={styles.celebrateGlow}>
          <View style={styles.celebrateCircle}>
            <Ionicons name="checkmark" size={44} color="#fff" />
          </View>
        </View>
        <Text style={styles.resultTitle}>ชำระเงินสำเร็จ</Text>
        <Text style={styles.resultBody}>{summary} — โควตาเพิ่มเข้าบัญชีร้านเรียบร้อยแล้ว</Text>

        {quota && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ข้อมูลโควตาปัจจุบัน</Text>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>สิทธิ์สร้าง Event เหลือ</Text>
              <Text style={styles.statValue}>{quota.event_balance} ครั้ง</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>กองตั๋วเหลือ</Text>
              <Text style={styles.statValue}>{quota.ticket_balance} ใบ</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>เพดานตั๋ว/Event</Text>
              <Text style={styles.statValue}>{quota.ticket_per_event} ใบ</Text>
            </View>
          </View>
        )}

        {purchase && (
          <View style={styles.card}>
            <View style={styles.detailRow}>
              <Text style={styles.statLabel}>แพ็กเกจ</Text>
              <Text style={styles.statValue}>{quota?.package.name ?? purchase.package_code}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.statLabel}>เลขอ้างอิง</Text>
              <Text style={styles.statValueMono}>{payment.provider_ref}</Text>
            </View>
            <View style={[styles.detailRow, styles.detailRowLast]}>
              <Text style={styles.statLabel}>ช่องทางชำระเงิน</Text>
              <Text style={styles.statValue}>QR Payment</Text>
            </View>
          </View>
        )}

        <PrimaryButton title="เสร็จสิ้น" onPress={() => navigation.popTo('Packages')} style={styles.resultButton} />
        <PrimaryButton
          title="ดูประวัติการสั่งซื้อ"
          variant="secondary"
          onPress={() => navigation.navigate('PurchaseHistory')}
          style={styles.resultButton}
        />
      </ScrollView>
    );
  }

  if (status === 'failed') {
    return (
      <View style={styles.resultContainer}>
        <View style={[styles.iconCircle, { backgroundColor: colors.dangerBg }]}>
          <Ionicons name="close-circle-outline" size={40} color={colors.danger} />
        </View>
        <Text style={styles.resultTitle}>ชำระเงินไม่สำเร็จ</Text>
        <Text style={styles.resultBody}>ยังไม่มีการหักโควตาหรือเงินใด ๆ ลองสั่งซื้อใหม่อีกครั้งได้</Text>
        <PrimaryButton title="กลับ" variant="secondary" onPress={() => navigation.goBack()} style={styles.resultButton} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ErrorBanner message={error} />

      <Text style={styles.summary}>{summary}</Text>
      <Text style={styles.amount}>{payment.amount_baht.toLocaleString('th-TH')} ฿</Text>

      <View style={styles.qrCard}>
        {payment.payload?.qr_data ? (
          <QRCode value={payment.payload.qr_data} size={200} />
        ) : (
          <Text style={styles.qrMissing}>ไม่มีข้อมูล QR</Text>
        )}
        <Text style={styles.qrHint}>สแกนเพื่อชำระเงิน</Text>
      </View>

      <View style={styles.waitingRow}>
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
        <Text style={styles.waitingText}>กำลังรอการยืนยันจากผู้ให้บริการ...</Text>
      </View>

      {devConfirm && (
        <View style={styles.devCard}>
          <Text style={styles.devTitle}>โหมดทดสอบ</Text>
          <Text style={styles.devBody}>
            ยังไม่ได้ต่อ payment gateway จริง ปุ่มนี้จำลองการแจ้งผลจากธนาคาร โดยยิงเข้า webhook ตัวเดียวกับที่ของจริงจะใช้
          </Text>
          <PrimaryButton title="จำลองว่าชำระเงินแล้ว" loading={busy} onPress={onDevPay} style={styles.devButton} />
        </View>
      )}

      <Text style={styles.footnote}>ปิดแอปตอนนี้ได้ — เมื่อชำระเงินสำเร็จ โควตาจะเข้าบัญชีอัตโนมัติ</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, alignItems: 'center', paddingBottom: spacing.xl },
  summary: { fontSize: 15, color: colors.text, textAlign: 'center' },
  amount: { fontSize: 34, fontWeight: '800', color: colors.primary },
  qrCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    ...shadows.card,
  },
  qrMissing: { color: colors.textMuted, fontSize: 13 },
  qrHint: { fontSize: 12, color: colors.textMuted },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  waitingText: { fontSize: 13, color: colors.textMuted },
  devCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  devTitle: { fontSize: 13, fontWeight: '700', color: colors.warning },
  devBody: { fontSize: 12, color: colors.warning, lineHeight: 17 },
  devButton: { marginTop: spacing.sm },
  footnote: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  resultContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  resultScrollContent: {
    flexGrow: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  resultTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  resultBody: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  resultButton: { marginTop: spacing.sm, alignSelf: 'stretch' },

  celebrateGlow: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: colors.primaryPill,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  celebrateCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },

  card: {
    alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.card,
    padding: spacing.md, gap: spacing.sm, marginTop: spacing.sm,
    ...shadows.card,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel: { fontSize: 13, color: colors.textMuted },
  statValue: { fontSize: 13, fontWeight: '700', color: colors.text },
  statValueMono: { fontSize: 13, fontWeight: '700', color: colors.text, fontFamily: 'monospace' },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  detailRowLast: { borderBottomWidth: 0 },
});
