import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { Alert, AppState, SectionList, Pressable, StyleSheet, View, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { useAuth } from '../context/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { formatIsoDateTime } from '../utils/datetime';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NotificationCenter'>;

type NotificationItem = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 30_000; // ไม่ poll ถี่กว่านี้ — เฉพาะตอนอยู่หน้านี้ + แอป foreground

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function notificationTitle(item: NotificationItem): string {
  switch (item.type) {
    case 'invite_staff':
      return 'คำเชิญเป็นพนักงานร้าน';
    case 'ticket_shared':
      return 'มีคนรับตั๋วที่คุณแชร์แล้ว';
    case 'ticket_received':
      return 'คุณได้รับตั๋วที่แชร์มา';
    case 'vendor_verification_result':
      return str(item.payload, 'decision') === 'approved' ? 'ร้านค้าของคุณได้รับอนุมัติแล้ว' : 'คำขอเปิดร้านค้าไม่ผ่านการอนุมัติ';
    case 'event_banned':
      return 'Event ถูกระงับโดยผู้ดูแลระบบ';
    case 'account_suspended':
      return 'บัญชีของคุณถูกระงับ';
    case 'account_restored':
      return 'บัญชีของคุณกลับมาใช้งานได้แล้ว';
    case 'vendor_suspended':
      return 'ร้านค้าของคุณถูกระงับ';
    case 'vendor_restored':
      return 'ร้านค้าของคุณกลับมาใช้งานได้แล้ว';
    default:
      return 'การแจ้งเตือน';
  }
}

function notificationBody(item: NotificationItem): string {
  const p = item.payload;
  switch (item.type) {
    case 'invite_staff':
      return 'แตะ "ตอบรับ" เพื่อเข้าร่วมเป็นพนักงานของร้านนี้';
    case 'ticket_shared':
      return 'ตั๋วที่คุณแชร์ถูกเพื่อนรับไปแล้ว — ตั๋วใบนี้ย้ายไปอยู่กับเพื่อนแล้ว';
    case 'ticket_received':
      return 'ดูตั๋วใบใหม่ได้ที่ ตั๋วของฉัน';
    case 'vendor_verification_result': {
      const reason = str(p, 'reason');
      return reason ? `เหตุผล: ${reason}` : '';
    }
    case 'event_banned': {
      const title = str(p, 'eventTitle');
      const reason = str(p, 'reason');
      return [title ? `Event: ${title}` : null, reason ? `เหตุผล: ${reason}` : null].filter(Boolean).join(' · ');
    }
    case 'account_suspended':
    case 'vendor_suspended': {
      const reason = str(p, 'reason');
      return reason ? `เหตุผล: ${reason}` : '';
    }
    case 'account_restored':
      return 'คุณสามารถเข้าสู่ระบบและใช้งานได้ตามปกติแล้ว';
    case 'vendor_restored':
      return 'ร้านค้าของคุณกลับมาเปิดใช้งานได้ตามปกติแล้ว';
    default:
      return '';
  }
}

// สีไอคอนต่อประเภท ตาม Figma (316:818) — บับเบิลสีต่างกันช่วยแยกประเภทแจ้งเตือนได้เร็วขึ้นตอนกวาดตา
function notificationIcon(item: NotificationItem): {
  name: React.ComponentProps<typeof Ionicons>['name'];
  bg: string;
  color: string;
} {
  switch (item.type) {
    case 'ticket_received':
      return { name: 'ticket-outline', bg: colors.primarySoft, color: colors.primary };
    case 'ticket_shared':
      return { name: 'checkmark-circle-outline', bg: colors.statusActiveBg, color: colors.statusActiveText };
    case 'invite_staff':
      return { name: 'person-add-outline', bg: colors.primarySoft, color: colors.primary };
    case 'vendor_verification_result':
      return str(item.payload, 'decision') === 'approved'
        ? { name: 'checkmark-circle-outline', bg: colors.statusActiveBg, color: colors.statusActiveText }
        : { name: 'alert-circle-outline', bg: colors.dangerBg, color: colors.danger };
    case 'event_banned':
    case 'account_suspended':
    case 'vendor_suspended':
      return { name: 'ban-outline', bg: colors.dangerBg, color: colors.danger };
    case 'account_restored':
    case 'vendor_restored':
      return { name: 'checkmark-circle-outline', bg: colors.statusActiveBg, color: colors.statusActiveText };
    default:
      return { name: 'notifications-outline', bg: colors.neutralBubble, color: colors.textMuted };
  }
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function groupBySection(items: NotificationItem[]): { title: string; data: NotificationItem[] }[] {
  const today = items.filter((i) => isToday(i.createdAt));
  const earlier = items.filter((i) => !isToday(i.createdAt));
  const sections: { title: string; data: NotificationItem[] }[] = [];
  if (today.length) sections.push({ title: 'วันนี้', data: today });
  if (earlier.length) sections.push({ title: 'ก่อนหน้านี้', data: earlier });
  return sections;
}

export default function NotificationCenterScreen({ navigation }: Props) {
  const { refreshMe } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which button on which card is mid-flight — the action matters now that a card has two.
  const [busyAction, setBusyAction] = useState<{ id: string; action: 'accept' | 'reject' } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<NotificationItem[]>('/v1/notifications');
      setItems(data);
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดการแจ้งเตือนไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      const startPolling = () => {
        if (timer === null) timer = setInterval(load, POLL_INTERVAL_MS);
      };
      const stopPolling = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      load();
      if (AppState.currentState === 'active') startPolling();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          load();
          startPolling();
        } else {
          stopPolling();
        }
      });

      return () => {
        stopPolling();
        subscription.remove();
      };
    }, [load])
  );

  const markRead = async (item: NotificationItem) => {
    if (item.readAt) return;
    try {
      await apiRequest(`/v1/notifications/${item.id}/read`, { method: 'PATCH' });
      await load();
    } catch {
      // best-effort — read state isn't worth blocking navigation over
    }
  };

  const onInviteDecision = async (item: NotificationItem, action: 'accept' | 'reject') => {
    const assignmentId = str(item.payload, 'assignmentId');
    if (!assignmentId) return;
    setBusyAction({ id: item.id, action });
    try {
      await apiRequest(`/v1/staff/invitations/${assignmentId}/${action}`, { method: 'POST' });
      // Marking read here is what makes the buttons disappear — the card press no longer does it.
      await apiRequest(`/v1/notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => undefined);
      if (action === 'accept') {
        await refreshMe(); // roles change — BottomTabBar's scan-tab gate reads this
      }
      await load();
      toast(
        action === 'accept'
          ? 'ตอบรับคำเชิญแล้ว คุณเป็นพนักงานของร้านนี้แล้ว'
          : 'ปฏิเสธคำเชิญแล้ว ร้านสามารถส่งคำเชิญใหม่ได้ภายหลัง'
      );
    } catch (err) {
      const message = errorMessageTh(
        err,
        action === 'accept' ? 'ตอบรับคำเชิญไม่สำเร็จ ลองใหม่อีกครั้ง' : 'ปฏิเสธคำเชิญไม่สำเร็จ ลองใหม่อีกครั้ง'
      );
      Alert.alert('ไม่สำเร็จ', message);
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <SkeletonList count={5} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SectionList
        sections={groupBySection(items)}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
        ListHeaderComponent={<ErrorBanner message={error} onRetry={load} />}
        ListEmptyComponent={
          error ? null : (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="notifications-off-outline"
                title="ยังไม่มีการแจ้งเตือน"
                hint="เราจะแจ้งให้คุณทราบเมื่อมีข่าวสารใหม่ๆ ดึงหน้าจอลงเพื่อโหลดใหม่"
                actionLabel="รีเฟรช"
                onAction={load}
              />
            </View>
          )
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => {
          const isInvite = item.type === 'invite_staff';
          const busyHere = busyAction?.id === item.id;
          const busyAccept = busyHere && busyAction?.action === 'accept';
          const busyReject = busyHere && busyAction?.action === 'reject';
          const icon = notificationIcon(item);
          return (
            // Invite cards must NOT be marked read on tap: the buttons below are gated on
            // !readAt, so auto-marking would hide them for good and strand the invitation
            // at status 'invited' forever. Accept/reject mark it read themselves instead.
            <Pressable
              style={[styles.card, !item.readAt && styles.cardUnread]}
              onPress={() => {
                if (isInvite) return;
                markRead(item);
                // อนุมัติแล้ว = พร้อมตั้งค่าร้าน — VendorSignupScreen เองมี logic เช็คอยู่แล้วว่า
                // จะโชว์การ์ด "ตั้งค่าร้านของฉัน" หรือ redirect เข้า ShopDashboard เลยถ้ามีร้านแล้ว
                if (item.type === 'vendor_verification_result' && str(item.payload, 'decision') === 'approved') {
                  navigation.navigate('VendorSignup');
                }
              }}
            >
              <View style={[styles.iconBubble, { backgroundColor: icon.bg }]}>
                <Ionicons name={icon.name} size={20} color={icon.color} />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardHeader}>
                  <Text style={styles.title}>{notificationTitle(item)}</Text>
                  {!item.readAt ? <View style={styles.dot} /> : null}
                </View>
                {notificationBody(item) ? <Text style={styles.body}>{notificationBody(item)}</Text> : null}
                <Text style={styles.time}>{formatIsoDateTime(item.createdAt)}</Text>

                {isInvite && !item.readAt ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      style={[styles.acceptBtn, busyAccept && styles.busy]}
                      disabled={busyHere}
                      onPress={() => onInviteDecision(item, 'accept')}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busyHere, busy: busyAccept }}
                    >
                      <Text style={styles.acceptText}>{busyAccept ? 'กำลังตอบรับ...' : 'ตอบรับ'}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.rejectBtn, busyReject && styles.busy]}
                      disabled={busyHere}
                      onPress={() => onInviteDecision(item, 'reject')}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busyHere, busy: busyReject }}
                    >
                      <Text style={styles.rejectText}>{busyReject ? 'กำลังปฏิเสธ...' : 'ปฏิเสธ'}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  sectionHeader: {
    ...type.label, color: colors.textMuted,
    paddingHorizontal: spacing.xs, marginTop: spacing.md, marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  // ยังไม่อ่าน = พื้นเขียวอ่อนของแบรนด์ปัจจุบัน (เดิม rgba ของเขียวรุ่นเก่าที่ไม่อยู่ใน theme)
  cardUnread: { backgroundColor: colors.primarySoft, borderColor: colors.primaryPill },
  cardBody: { flex: 1, gap: 2 },
  iconBubble: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...type.bodyStrong, flex: 1, color: colors.text },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  body: { ...type.bodySmall, color: colors.text },
  time: { ...type.caption, color: colors.textMuted },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  acceptBtn: {
    flex: 1, backgroundColor: colors.primary, borderRadius: radius.pill,
    minHeight: touch.min, alignItems: 'center', justifyContent: 'center',
  },
  rejectBtn: {
    flex: 1, borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: radius.pill,
    minHeight: touch.min, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  busy: { opacity: 0.6 },
  acceptText: { ...type.label, color: '#fff' },
  rejectText: { ...type.label, color: colors.text },

  emptyWrap: { flex: 1, justifyContent: 'center', paddingTop: 40 },
});
