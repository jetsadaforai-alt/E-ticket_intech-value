import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { listMyShares, listMyClaims, type SharedTicket, type ClaimedTicket } from '../api/tickets';
import { errorMessageTh } from '../api/errorMessages';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { SkeletonList } from '../components/Skeleton';
import { formatIsoDateTime } from '../utils/datetime';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareHistory'>;

type Tab = 'sent' | 'received';

const TABS: { key: Tab; label: string }[] = [
  { key: 'sent', label: 'แชร์ให้คนอื่น' },
  { key: 'received', label: 'ได้รับจากคนอื่น' },
];

const SHARE_STATUS: Record<SharedTicket['status'], { label: string; bg: string; fg: string }> = {
  pending: { label: 'รอเพื่อนกดรับ', bg: colors.statusPendingBg, fg: colors.statusPendingText },
  claimed: { label: 'เพื่อนรับแล้ว', bg: colors.statusActiveBg, fg: colors.statusActiveText },
  expired: { label: 'รหัสหมดอายุ', bg: colors.statusUsedBg, fg: colors.statusUsedText },
};

// Same fixed lifetime the backend gives every share code (routes/tickets.js
// SHARE_TTL_HOURS) — used only to *display* the deadline of a pending code; the list
// endpoint already tells us whether a code has expired.
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;

export default function ShareHistoryScreen(_props: Props) {
  const [tab, setTab] = useState<Tab>('sent');
  const [shares, setShares] = useState<SharedTicket[] | null>(null);
  const [claims, setClaims] = useState<ClaimedTicket[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([listMyShares(), listMyClaims()]);
      setShares(s);
      setClaims(c);
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดประวัติการแชร์ไม่สำเร็จ'));
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

  const loaded = tab === 'sent' ? shares : claims;
  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
  );

  let body: React.ReactNode;
  if (!loaded && !error) {
    body = <SkeletonList count={4} />;
  } else if (!loaded) {
    body = (
      <View style={styles.errorWrap}>
        <ErrorBanner message={error} onRetry={load} />
      </View>
    );
  } else if (tab === 'sent') {
    body = (
      <FlatList
        data={shares ?? []}
        keyExtractor={(item, i) => `${item.ticket_id}-${item.shared_at}-${i}`}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={load} /> : null}
        ListEmptyComponent={
          <EmptyState
            icon="share-social-outline"
            title="ยังไม่เคยแชร์ตั๋วให้ใคร"
            hint="เปิดตั๋วที่ใช้ได้ แล้วกด 'แชร์ตั๋วให้เพื่อน' เพื่อส่งรหัสให้เพื่อน"
          />
        }
        renderItem={({ item }) => {
          const s = SHARE_STATUS[item.status] ?? SHARE_STATUS.expired;
          const deadline = new Date(new Date(item.shared_at).getTime() + SHARE_TTL_MS).toISOString();
          return (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.event_title}
                </Text>
                <View style={[styles.badge, { backgroundColor: s.bg }]}>
                  <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                <Text style={styles.detail}>
                  {item.claimed_by_name ? `รับโดย ${item.claimed_by_name}` : 'ยังไม่มีคนรับ — ตั๋วยังเป็นของคุณ'}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                <Text style={styles.date}>
                  {item.claimed_at
                    ? `รับเมื่อ ${formatIsoDateTime(item.claimed_at)}`
                    : `แชร์เมื่อ ${formatIsoDateTime(item.shared_at)}`}
                </Text>
              </View>
              {item.status === 'pending' ? (
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={14} color={colors.statusPendingText} />
                  <Text style={[styles.date, { color: colors.statusPendingText }]}>
                    รหัสใช้ได้ถึง {formatIsoDateTime(deadline)}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    );
  } else {
    body = (
      <FlatList
        data={claims ?? []}
        keyExtractor={(item, i) => `${item.ticket_id}-${item.claimed_at}-${i}`}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={load} /> : null}
        ListEmptyComponent={
          <EmptyState
            icon="gift-outline"
            title="ยังไม่เคยได้รับตั๋วจากใคร"
            hint="เมื่อเพื่อนแชร์รหัสมา กรอกได้ที่ ตั๋วของฉัน > รับตั๋วที่เพื่อนแชร์มา"
          />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title} numberOfLines={2}>
              {item.event_title}
            </Text>
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={14} color={colors.textMuted} />
              <Text style={styles.detail}>แชร์โดย {item.shared_by_name}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.date}>รับเมื่อ {formatIsoDateTime(item.claimed_at)}</Text>
            </View>
          </View>
        )}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow} accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.flex}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  tabRow: {
    flexDirection: 'row',
    margin: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.pill,
    padding: 4,
  },
  tab: { flex: 1, minHeight: touch.min - 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  tabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabLabel: { ...type.label, color: colors.textMuted },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  errorWrap: { padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    ...shadows.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: 2 },
  title: { ...type.bodyStrong, color: colors.text, flex: 1 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: { ...type.captionStrong },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detail: { ...type.bodySmall, color: colors.textMuted, flexShrink: 1 },
  date: { ...type.caption, color: colors.textMuted },
});
