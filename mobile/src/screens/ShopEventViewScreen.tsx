import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, ScrollView, Image, StyleSheet } from 'react-native';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { resolveAssetUrl } from '../utils/assetUrl';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
import { formatIsoDateTime, formatIsoDateOnly } from '../utils/datetime';
import { useRequireMode } from '../hooks/useRequireMode';
import { formatDiscountBadge } from '../api/products';
import { colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShopEventView'>;

type EventDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startTime: string;
  endTime: string;
  images: { id: string; imageUrl: string }[];
  redemptionWindow: {
    validFrom: string | null;
    validUntil: string | null;
    slots: { dayOfWeek: string; startTime: string; endTime: string }[];
  } | null;
  /** Empty = the discount covers the whole shop. */
  products: { id: string; name: string; priceBaht: string; status: string }[];
  ticketBatch: { totalQty: number; remainingCount: number; discountValueBaht: string } | null;
  discount_min_baht: number;
  discount_max_baht: number;
};

const DAY_TH: Record<string, string> = { MON: 'จ', TUE: 'อ', WED: 'พ', THU: 'พฤ', FRI: 'ศ', SAT: 'ส', SUN: 'อา' };
const STATUS_TH: Record<string, string> = {
  active: 'เปิดอยู่',
  expired: 'หมดเวลา',
  cancelled: 'ยกเลิกแล้ว',
  banned: 'ถูกระงับโดยผู้ดูแลระบบ',
};

// Read-only counterpart of EventFormScreen's edit mode, for staff who may scan but not edit.
export default function ShopEventViewScreen({ route, navigation }: Props) {
  const { eventId } = route.params;
  useRequireMode(['vendor', 'staff'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }));
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<EventDetail>(`/v1/events/${eventId}`, { auth: false });
      setEvent(data);
      setError(null);
    } catch {
      setError('โหลดรายละเอียด Event ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <LoadingView label="กำลังโหลด Event..." />;

  if (!event) {
    return (
      <View style={styles.errorOnly}>
        <ErrorBanner message={error ?? 'ไม่พบ Event นี้'} />
      </View>
    );
  }

  const win = event.redemptionWindow;
  const hasWindow = win && (win.validFrom || win.validUntil || win.slots.length > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ErrorBanner message={error} />

      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.status}>สถานะ: {STATUS_TH[event.status] ?? event.status}</Text>

      {event.images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gallery}>
          {event.images.map((img) => (
            <Image key={img.id} source={{ uri: resolveAssetUrl(img.imageUrl) ?? undefined }} style={styles.galleryImage} />
          ))}
        </ScrollView>
      )}

      <View style={styles.card}>
        <Row label="ช่วงเวลา Event" value={`${formatIsoDateTime(event.startTime)} - ${formatIsoDateTime(event.endTime)}`} />
        <Row label="มูลค่าส่วนลด" value={formatDiscountBadge(event.discount_min_baht, event.discount_max_baht)} />
        <Row
          label="ลดเฉพาะสินค้า"
          value={
            event.products?.length > 0
              // Archived-but-still-linked products stay in this list on purpose (an
              // event that already discounts one keeps saying so) — "(หมด)" is the only
              // sign that it's no longer something the shop can restock.
              ? event.products.map((p) => (p.status === 'archived' ? `${p.name} (หมด)` : p.name)).join(', ')
              : 'ทุกอย่างในร้าน'
          }
        />
        <Row
          label="ตั๋วคงเหลือ"
          value={`${event.ticketBatch?.remainingCount ?? 0} / ${event.ticketBatch?.totalQty ?? 0} ใบ`}
        />
      </View>

      {event.description ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>รายละเอียด</Text>
          <Text style={styles.description}>{event.description}</Text>
        </View>
      ) : null}

      {hasWindow ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>เงื่อนไขการใช้สิทธิ์</Text>
          {win!.validFrom || win!.validUntil ? (
            <Text style={styles.description}>
              ใช้สิทธิ์ได้: {formatIsoDateOnly(win!.validFrom) || 'ไม่จำกัดวันเริ่ม'} ถึง{' '}
              {formatIsoDateOnly(win!.validUntil) || 'ไม่จำกัดวันสิ้นสุด'}
            </Text>
          ) : null}
          {win!.slots.length > 0 ? (
            <Text style={styles.description}>
              ช่วงเวลา:{' '}
              {win!.slots.map((s) => `${DAY_TH[s.dayOfWeek] ?? s.dayOfWeek} ${s.startTime}-${s.endTime}`).join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {event.status === 'active' && (
        <PrimaryButton
          title="สแกนตั๋วของ Event นี้"
          onPress={() => navigation.navigate('Scanner', { eventId: event.id, eventTitle: event.title })}
          style={styles.scanButton}
        />
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  errorOnly: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  status: { fontSize: 13, color: colors.textMuted },
  gallery: { flexGrow: 0 },
  galleryImage: { width: 200, height: 150, borderRadius: radius.md, marginRight: spacing.sm, backgroundColor: colors.border },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  row: { gap: 2 },
  rowLabel: { fontSize: 12, color: colors.textMuted },
  rowValue: { fontSize: 15, fontWeight: '600', color: colors.text },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  description: { fontSize: 14, color: colors.text, lineHeight: 20 },
  scanButton: { marginTop: spacing.sm },
});
