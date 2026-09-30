import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, AppState, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { getSocket } from '../services/socket';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
import { formatIsoDateTime } from '../utils/datetime';
import { colors, radius, shadows, spacing, touch, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = NativeStackScreenProps<RootStackParamList, 'SupportThread'>;

type Message = { id: string; sender_type: 'user' | 'admin'; message: string; created_at: string };
type Thread = {
  id: string;
  category: string;
  status: string;
  resolution_note: string | null;
  created_at: string;
  assigned_admin: { id: string; username: string } | null;
  admin_last_read_at: string | null;
  messages: Message[];
};

const CATEGORY_TH: Record<string, string> = {
  redemption_dispute: 'ปัญหาการใช้สิทธิ์',
  billing_issue: 'ปัญหาการชำระเงิน',
  fraud_report: 'แจ้งการทุจริต',
  other: 'อื่น ๆ',
};

const STATUS_TH: Record<string, string> = {
  open: 'รอตรวจสอบ',
  investigating: 'กำลังตรวจสอบ',
  resolved: 'แก้ไขแล้ว',
  closed: 'ปิดเรื่องแล้ว',
};

// Real-time updates come from the 'changed' socket event (see services/socket.ts and
// backend/src/services/realtime.js) — this is now just a fallback in case the socket
// drops and silently fails to reconnect, not the primary update path.
const POLL_INTERVAL_MS = 60_000;

export default function SupportThreadScreen({ route }: Props) {
  const { ticketId } = route.params;
  // เข้าจากหน้าโปรไฟล์ได้ทั้งโหมดลูกค้าและโหมดร้าน จึงอ่านสีตามโหมด
  const c = useColors();
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<Thread>(`/v1/support-tickets/${ticketId}`);
      setThread(data);
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดเรื่องที่แจ้งไม่สำเร็จ'));
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        if (timer === null) timer = setInterval(load, POLL_INTERVAL_MS);
      };
      const stop = () => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };

      let cancelled = false;
      getSocket().then((socket) => {
        if (cancelled) return;
        socket.emit('join-ticket', ticketId);
        socket.on('changed', load);
      });

      load();
      if (AppState.currentState === 'active') start();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          load();
          start();
        } else {
          stop();
        }
      });

      return () => {
        cancelled = true;
        stop();
        sub.remove();
        getSocket().then((socket) => socket.off('changed', load));
      };
    }, [load, ticketId])
  );

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await apiRequest(`/v1/support-tickets/${ticketId}/messages`, { method: 'POST', body: { message: text } });
      setDraft('');
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (err) {
      setError(errorMessageTh(err, 'ส่งข้อความไม่สำเร็จ ข้อความยังอยู่ในช่องพิมพ์ กดส่งอีกครั้งได้'));
    } finally {
      setSending(false);
    }
  };

  if (!thread) {
    return error ? (
      <View style={styles.errorOnly}>
        <EmptyState icon="cloud-offline-outline" title="โหลดเรื่องที่แจ้งไม่สำเร็จ" hint={error} />
        <PrimaryButton title="ลองใหม่" icon="refresh" onPress={load} />
      </View>
    ) : (
      <LoadingView label="กำลังโหลด..." />
    );
  }

  const isClosed = thread.status === 'closed';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.headerCard}>
        <Text style={styles.headerCategory}>{CATEGORY_TH[thread.category] ?? thread.category}</Text>
        <Text style={styles.headerStatus}>สถานะ: {STATUS_TH[thread.status] ?? thread.status}</Text>
        {thread.resolution_note ? (
          <View style={styles.resolutionBox}>
            <Ionicons name="checkmark-circle" size={16} color={colors.statusActiveText} />
            <Text style={styles.resolution}>สรุป: {thread.resolution_note}</Text>
          </View>
        ) : null}
      </View>

      <ErrorBanner message={error} />

      <FlatList
        ref={listRef}
        data={thread.messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.sender_type === 'user';
          const read = mine && !!thread.admin_last_read_at && thread.admin_last_read_at >= item.created_at;
          return (
            <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
              <View style={[styles.bubble, mine ? [styles.bubbleMine, { backgroundColor: c.primary }] : styles.bubbleTheirs]}>
                {!mine && (
                  <Text style={[styles.adminTag, { color: c.primary }]}>
                    {thread.assigned_admin?.username ?? 'ทีมงาน'}
                  </Text>
                )}
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.message}</Text>
                <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                  {formatIsoDateTime(item.created_at)}{mine ? (read ? ' · อ่านแล้ว' : ' · ส่งแล้ว') : ''}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {isClosed ? (
        <View style={styles.closedNotice}>
          <Text style={styles.closedNoticeText}>เรื่องนี้ปิดแล้ว — หากยังมีปัญหากรุณาแจ้งเรื่องใหม่</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="พิมพ์ข้อความ..."
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: c.primary }, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="ส่งข้อความ"
            accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  errorOnly: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center', gap: spacing.md },
  headerCard: {
    margin: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  headerCategory: { ...type.subheading, color: colors.text },
  headerStatus: { ...type.bodySmall, color: colors.textMuted },
  resolutionBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.xs,
    backgroundColor: colors.statusActiveBg, borderRadius: radius.sm, padding: spacing.sm,
  },
  resolution: { ...type.bodySmall, color: colors.statusActiveText, flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: radius.badge },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.badge },
  adminTag: { ...type.captionStrong, color: colors.primary },
  bubbleText: { ...type.body, color: colors.text },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.85)' },
  closedNotice: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  closedNoticeText: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: touch.min,
    ...type.body,
    color: colors.text,
  },
  sendButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});
