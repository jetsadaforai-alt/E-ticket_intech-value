import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, FlatList, TouchableOpacity, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { formatIsoDateTime } from '../utils/datetime';
import { colors, radius, shadows, spacing, touch, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = NativeStackScreenProps<RootStackParamList, 'SupportList'>;

type TicketRow = {
  id: string;
  category: string;
  status: string;
  last_message: string | null;
  created_at: string;
};

// Must match CATEGORIES in backend/src/routes/adminSupport.js — the API 400s otherwise.
const CATEGORIES: { value: string; label: string }[] = [
  { value: 'redemption_dispute', label: 'ปัญหาการใช้สิทธิ์' },
  { value: 'billing_issue', label: 'ปัญหาการชำระเงิน' },
  { value: 'fraud_report', label: 'แจ้งการทุจริต' },
  { value: 'other', label: 'อื่น ๆ' },
];

const CATEGORY_TH: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const STATUS_TH: Record<string, string> = {
  open: 'รอตรวจสอบ',
  investigating: 'กำลังตรวจสอบ',
  resolved: 'แก้ไขแล้ว',
  closed: 'ปิดเรื่องแล้ว',
};

// Status as a filled pill (was coloured text only) — bg + text pairs from the theme.
const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  open: { bg: colors.statusPendingBg, fg: colors.statusPendingText },
  resolved: { bg: colors.statusActiveBg, fg: colors.statusActiveText },
  closed: { bg: colors.statusUsedBg, fg: colors.statusUsedText },
};

export default function SupportListScreen({ navigation }: Props) {
  // เข้าจากหน้าโปรไฟล์ได้ทั้งโหมดลูกค้าและโหมดร้าน จึงอ่านสีตามโหมด
  // (ตั้งชื่อ pal ไม่ใช่ c เพราะ c ถูกใช้เป็นตัวแปรหมวดหมู่ในลูปด้านล่างแล้ว)
  const pal = useColors();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true); // ครั้งแรกเท่านั้น
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const [composing, setComposing] = useState(false);
  const [category, setCategory] = useState('redemption_dispute');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<TicketRow[]>('/v1/support-tickets');
      setTickets(data);
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดรายการเรื่องที่แจ้งไม่สำเร็จ'));
    } finally {
      setLoading(false);
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

  const onSubmit = async () => {
    if (!message.trim()) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiRequest('/v1/support-tickets', { method: 'POST', body: { category, message: message.trim() } });
      setMessage('');
      setComposing(false);
      await load();
      toast('ส่งเรื่องแล้ว ทีมงานจะติดต่อกลับตามลำดับคำขอ');
    } catch (err) {
      setSubmitError(errorMessageTh(err, 'ส่งเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <PrimaryButton
          title={composing ? 'ยกเลิก' : 'แจ้งเรื่องใหม่'}
          icon={composing ? undefined : 'add'}
          variant={composing ? 'secondary' : 'primary'}
          onPress={() => setComposing((v) => !v)}
        />
      </View>

      {composing && (
        <View style={styles.composeCard}>
          <Text style={styles.composeLabel}>หมวดปัญหา</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((c) => {
              const selected = c.value === category;
              return (
                <Pressable
                  key={c.value}
                  style={[styles.categoryChip, selected && { backgroundColor: pal.primary, borderColor: pal.primary }]}
                  onPress={() => setCategory(c.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <FormField
            label="รายละเอียดปัญหา"
            value={message}
            onChangeText={setMessage}
            placeholder="เล่าสิ่งที่เกิดขึ้นให้ทีมงานทราบ เช่น ร้าน วันเวลา และรหัสตั๋ว"
            style={{ height: 120, textAlignVertical: 'top' }}
            multiline
          />

          <ErrorBanner message={submitError} />
          <PrimaryButton title="ส่งเรื่อง" onPress={onSubmit} loading={submitting} disabled={!message.trim()} />
        </View>
      )}

      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[pal.primary]} tintColor={pal.primary} />
          }
          ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={load} /> : null}
          ListEmptyComponent={
            error ? null : (
              <EmptyState
                icon="help-buoy-outline"
                title="ยังไม่เคยแจ้งเรื่องไว้"
                hint="มีปัญหาเรื่องใช้สิทธิ์ การชำระเงิน หรือพบการทุจริต กด 'แจ้งเรื่องใหม่' ได้เลย"
              />
            )
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            // 'investigating' is the one status painted in the brand colour, so it
            // follows the mode; the rest are fixed semantic colours.
            const pill =
              item.status === 'investigating'
                ? { bg: pal.primarySoft, fg: pal.primary }
                : STATUS_PILL[item.status] ?? STATUS_PILL.closed;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate('SupportThread', { ticketId: item.id })}
                accessibilityRole="button"
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardCategory} numberOfLines={1}>
                    {CATEGORY_TH[item.category] ?? item.category}
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <Text style={[styles.cardStatus, { color: pill.fg }]}>{STATUS_TH[item.status] ?? item.status}</Text>
                  </View>
                </View>
                <Text style={styles.cardPreview} numberOfLines={1}>
                  {item.last_message ?? '—'}
                </Text>
                <Text style={styles.cardTime}>{formatIsoDateTime(item.created_at)}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  actions: { padding: spacing.md, paddingBottom: spacing.sm },
  composeCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  composeLabel: { ...type.label, color: colors.text },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  categoryChipText: { ...type.label, color: colors.text },
  categoryChipTextSelected: { color: '#fff', fontWeight: '700' },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm, flexGrow: 1 },
  card: {
    padding: spacing.md,
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  cardCategory: { ...type.bodyStrong, color: colors.text, flex: 1 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  cardStatus: { ...type.captionStrong },
  cardPreview: { ...type.bodySmall, color: colors.textMuted },
  cardTime: { ...type.caption, color: colors.textMuted },
});
