import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { ApiError } from '../api/client';
import { getQuota, listPackages, type Package, type Quota } from '../api/quota';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Packages'>;

export default function PackageScreen({ navigation }: Props) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, current] = await Promise.all([listPackages(), getQuota()]);
      setPackages(list);
      setQuota(current);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'NO_VENDOR' ? 'ยังไม่มีร้าน' : 'โหลดแพ็กเกจไม่สำเร็จ');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onBuy = (pkg: Package) => {
    navigation.navigate('ConfirmPurchase', {
      request: { type: 'package', package_id: pkg.id },
      title: pkg.name,
      priceBaht: pkg.price_baht,
      resultSummary: `อัปเกรดเป็น ${pkg.name}`,
      quotaPreview: {
        ticketDelta: pkg.ticket_total,
        eventDelta: pkg.event_quota,
        newTicketPerEvent: pkg.ticket_per_event,
      },
    });
  };

  if (!quota && !error) return <LoadingView label="กำลังโหลดแพ็กเกจ..." />;

  const currentTier = quota?.package.tier ?? -1;

  return (
    <ScrollView
      style={styles.container}
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
    >
      <ErrorBanner message={error} />

      {quota && (
        <View style={styles.currentCard}>
          <Text style={styles.currentLabel}>แพ็กเกจปัจจุบัน</Text>
          <Text style={styles.currentName}>{quota.package.name}</Text>
          <Text style={styles.currentDetail}>
            เหลือตั๋ว {quota.ticket_balance} ใบ · สร้าง Event ได้อีก {quota.event_balance} ครั้ง · เพดาน{' '}
            {quota.ticket_per_event} ใบ/Event
          </Text>
        </View>
      )}

      <Text style={styles.explainer}>
        แพ็กเกจให้ทั้ง <Text style={styles.bold}>กองตั๋วรวม</Text> และ <Text style={styles.bold}>จำนวน Event</Text> ที่สร้างได้
        โดยมี <Text style={styles.bold}>เพดานตั๋วต่อ 1 Event</Text> กำกับ — ตั๋วที่เหลือจะเอาไปกระจุกใน Event เดียวไม่ได้
      </Text>

      {packages.map((pkg) => {
        const isCurrent = pkg.tier === currentTier;
        const isDowngrade = pkg.tier < currentTier;
        return (
          <View key={pkg.id} style={[styles.card, isCurrent && styles.cardCurrent]}>
            <View style={styles.cardHead}>
              <Text style={styles.cardName}>{pkg.name}</Text>
              <Text style={styles.cardPrice}>{pkg.price_baht === 0 ? 'ฟรี' : `${pkg.price_baht.toLocaleString('th-TH')} ฿`}</Text>
            </View>

            <Row icon="ticket-outline" text={`ตั๋วรวม ${pkg.ticket_total} ใบ`} />
            <Row icon="calendar-outline" text={`สร้าง Event ได้ ${pkg.event_quota} ครั้ง`} />
            <Row icon="lock-closed-outline" text={`สูงสุด ${pkg.ticket_per_event} ใบ ต่อ 1 Event`} />
            {pkg.topup_enabled ? (
              <Row
                icon="add-circle-outline"
                text={`ซื้อเพิ่มได้: Event ${pkg.event_topup_price} ฿ · ตั๋ว ${pkg.ticket_topup_bundle_size} ใบ ${pkg.ticket_topup_price} ฿`}
              />
            ) : (
              <Row icon="information-circle-outline" text="ซื้อโควตาเพิ่มไม่ได้ ต้องอัปเกรดแพ็กเกจ" muted />
            )}

            {isCurrent ? (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>ใช้อยู่ตอนนี้</Text>
              </View>
            ) : isDowngrade ? (
              // Downgrades are refused by the backend too — showing why up front beats
              // letting the tap fail.
              <Text style={styles.downgradeNote}>ต่ำกว่าแพ็กเกจปัจจุบัน ซื้อไม่ได้</Text>
            ) : (
              <PrimaryButton
                title={`อัปเกรดเป็น ${pkg.name}`}
                onPress={() => onBuy(pkg)}
                style={styles.buyButton}
              />
            )}
          </View>
        );
      })}

      <Text style={styles.footnote}>โควตาที่เหลืออยู่จะถูกรวมเข้ากับแพ็กเกจใหม่ ไม่หายไป</Text>
    </ScrollView>
  );
}

function Row({ icon, text, muted }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color={muted ? colors.textMuted : colors.primary} />
      <Text style={[styles.rowText, muted && styles.rowTextMuted]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  currentCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: 2,
  },
  currentLabel: { fontSize: 12, color: colors.primaryDark },
  currentName: { fontSize: 20, fontWeight: '800', color: colors.primaryDark },
  currentDetail: { fontSize: 12, color: colors.primaryDark },
  explainer: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  bold: { fontWeight: '700', color: colors.text },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardCurrent: { borderWidth: 1, borderColor: colors.primary },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  cardName: { fontSize: 18, fontWeight: '800', color: colors.text },
  cardPrice: { fontSize: 18, fontWeight: '800', color: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { fontSize: 13, color: colors.text, flex: 1 },
  rowTextMuted: { color: colors.textMuted },
  buyButton: { marginTop: spacing.sm },
  currentBadge: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryPill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  currentBadgeText: { color: colors.primaryDark, fontWeight: '700', fontSize: 12 },
  downgradeNote: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted },
  footnote: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});
