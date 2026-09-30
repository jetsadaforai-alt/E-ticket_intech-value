import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { getQuota, type PurchaseType, type Quota } from '../api/quota';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Topup'>;

const MAX_QUANTITY = 20;

export default function TopupScreen({ route, navigation }: Props) {
  const targetEventId = route.params?.eventId;
  const targetEventTitle = route.params?.eventTitle;

  const [quota, setQuota] = useState<Quota | null>(null);
  // Buying tickets for one specific event is the only thing that makes sense when we
  // arrived from that event's manage screen.
  const [kind, setKind] = useState<Extract<PurchaseType, 'event_topup' | 'ticket_topup'>>(
    targetEventId ? 'ticket_topup' : 'event_topup'
  );
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQuota(await getQuota());
      setError(null);
    } catch {
      setError('โหลดข้อมูลโควตาไม่สำเร็จ');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!quota) return error ? <ErrorBanner message={error} /> : <LoadingView label="กำลังโหลด..." />;

  const pkg = quota.package;

  if (!pkg.topup_enabled) {
    return (
      <View style={styles.lockedContainer}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.textMuted} />
        <Text style={styles.lockedTitle}>แพ็กเกจ {pkg.name} ซื้อโควตาเพิ่มไม่ได้</Text>
        <Text style={styles.lockedBody}>อัปเกรดเป็นแพ็กเกจแบบเสียเงินก่อน จึงจะซื้อ Event หรือตั๋วเพิ่มได้</Text>
        <PrimaryButton title="ดูแพ็กเกจ" onPress={() => navigation.navigate('Packages')} style={styles.lockedButton} />
      </View>
    );
  }

  const unitPrice = kind === 'event_topup' ? pkg.event_topup_price : pkg.ticket_topup_price;
  const total = unitPrice * quantity;
  const ticketsGained = pkg.ticket_topup_bundle_size * quantity;

  const onBuy = () => {
    const isTicketTopupForEvent = kind === 'ticket_topup' && Boolean(targetEventId);
    navigation.navigate('ConfirmPurchase', {
      request: {
        type: kind,
        quantity,
        target_event_id: kind === 'ticket_topup' ? targetEventId : undefined,
      },
      title: kind === 'event_topup' ? 'ซื้อ Event เพิ่ม' : 'ซื้อตั๋วเพิ่ม',
      priceBaht: total,
      resultSummary: kind === 'event_topup' ? `ซื้อ Event เพิ่ม ${quantity} ครั้ง` : `ซื้อตั๋วเพิ่ม ${ticketsGained} ใบ`,
      quotaPreview: {
        ticketDelta: ticketsGained,
        eventDelta: kind === 'event_topup' ? quantity : 0,
        targetEventTitle: isTicketTopupForEvent ? targetEventTitle : undefined,
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ErrorBanner message={error} />

      <View style={styles.quotaCard}>
        <Text style={styles.quotaLabel}>โควตาคงเหลือ ({pkg.name})</Text>
        <Text style={styles.quotaValue}>
          ตั๋ว {quota.ticket_balance} ใบ · Event {quota.event_balance} ครั้ง
        </Text>
        <Text style={styles.quotaHint}>เพดาน {quota.ticket_per_event} ใบ ต่อ 1 Event</Text>
      </View>

      {targetEventId && (
        <View style={styles.targetCard}>
          <Ionicons name="pricetag-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.targetText}>
            ตั๋วที่ซื้อจะเพิ่มเพดานให้ Event “{targetEventTitle ?? 'ที่เลือกไว้'}” โดยเฉพาะ
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>เลือกสิ่งที่ต้องการซื้อ</Text>
      <View style={styles.choices}>
        <Choice
          active={kind === 'event_topup'}
          disabled={Boolean(targetEventId)}
          title="ซื้อ Event เพิ่ม"
          subtitle={`${pkg.event_topup_price} ฿ / ครั้ง — ได้ตั๋ว ${pkg.ticket_topup_bundle_size} ใบมาด้วย`}
          onPress={() => setKind('event_topup')}
        />
        <Choice
          active={kind === 'ticket_topup'}
          title="ซื้อตั๋วเพิ่ม"
          subtitle={`${pkg.ticket_topup_price} ฿ / ชุด ${pkg.ticket_topup_bundle_size} ใบ`}
          onPress={() => setKind('ticket_topup')}
        />
      </View>

      <Text style={styles.sectionTitle}>จำนวน</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          onPress={() => setQuantity((q) => Math.max(1, q - 1))}
          disabled={quantity <= 1}
          style={[styles.stepperButton, quantity <= 1 && styles.stepperDisabled]}
          hitSlop={8}
        >
          <Ionicons name="remove" size={20} color={quantity <= 1 ? colors.textMuted : colors.primary} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{quantity}</Text>
        <TouchableOpacity
          onPress={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
          disabled={quantity >= MAX_QUANTITY}
          style={[styles.stepperButton, quantity >= MAX_QUANTITY && styles.stepperDisabled]}
          hitSlop={8}
        >
          <Ionicons name="add" size={20} color={quantity >= MAX_QUANTITY ? colors.textMuted : colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryCard}>
        <SummaryRow label="ได้ตั๋วเพิ่ม" value={`${ticketsGained} ใบ`} />
        {kind === 'event_topup' && <SummaryRow label="ได้ Event เพิ่ม" value={`${quantity} ครั้ง`} />}
        <View style={styles.divider} />
        <SummaryRow label="รวมทั้งสิ้น" value={`${total.toLocaleString('th-TH')} ฿`} strong />
      </View>

      <PrimaryButton title="ตรวจสอบและยืนยัน" onPress={onBuy} />
    </ScrollView>
  );
}

function Choice({
  active,
  disabled,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.choice, active && styles.choiceActive, disabled && styles.choiceDisabled]}
    >
      <Text style={[styles.choiceTitle, active && styles.choiceTitleActive]}>{title}</Text>
      <Text style={styles.choiceSubtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text>
      <Text style={[styles.summaryValue, strong && styles.summaryStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  lockedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background },
  lockedTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  lockedBody: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  lockedButton: { marginTop: spacing.md, alignSelf: 'stretch' },
  quotaCard: { backgroundColor: colors.primarySoft, borderRadius: radius.card, padding: spacing.md, gap: 2 },
  quotaLabel: { fontSize: 12, color: colors.primaryDark },
  quotaValue: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  quotaHint: { fontSize: 12, color: colors.primaryDark },
  targetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  targetText: { flex: 1, fontSize: 12, color: colors.text },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  choices: { gap: spacing.sm },
  choice: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
    ...shadows.card,
  },
  choiceActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  choiceDisabled: { opacity: 0.4 },
  choiceTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  choiceTitleActive: { color: colors.primaryDark },
  choiceSubtitle: { fontSize: 12, color: colors.textMuted },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDisabled: { opacity: 0.5 },
  stepperValue: { fontSize: 24, fontWeight: '800', color: colors.text, minWidth: 48, textAlign: 'center' },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 13, color: colors.textMuted },
  summaryValue: { fontSize: 13, color: colors.text },
  summaryStrong: { fontSize: 16, fontWeight: '800', color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
