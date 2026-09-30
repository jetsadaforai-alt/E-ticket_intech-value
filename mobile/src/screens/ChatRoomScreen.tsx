import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, AppState, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { colors, radius, spacing, touch, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

type Message = { id: string; sender_type: 'user' | 'shop'; message: string; created_at: string };
type Thread = {
  id: string;
  title: string;
  my_side: 'user' | 'shop';
  user_last_read_at: string | null;
  shop_last_read_at: string | null;
  messages: Message[];
};

// Real-time updates come from the 'changed' socket event (see services/socket.ts and
// backend/src/services/realtime.js) — this is now just a fallback in case the socket
// drops and silently fails to reconnect, not the primary update path.
const POLL_INTERVAL_MS = 60_000;

export default function ChatRoomScreen({ route, navigation }: Props) {
  const { conversationId, title } = route.params;
  // เข้าถึงได้ทั้งโหมดลูกค้าและโหมดร้าน จึงต้องอ่านสีตามโหมดปัจจุบัน
  const c = useColors();
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  // ตั้งแต่ Expo SDK 53 Android เป็น edge-to-edge โดยค่าเริ่มต้น — KeyboardAvoidingView's
  // built-in resize logic และ Keyboard event แบบเดิม (ลองมาแล้วทั้งคู่ ไม่เวิร์กจริงบน Android)
  // ใช้ไม่ได้กับโหมดนี้อีกต่อไป ความสูงคีย์บอร์ดต้องอ่านผ่าน insets.bottom ของ
  // useSafeAreaInsets() แทน (react-native-safe-area-context 5.x ติดตาม IME inset ให้เอง)
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({ title: title ?? 'แชท' });
  }, [navigation, title]);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<Thread>(`/v1/conversations/${conversationId}/messages`);
      setThread(data);
      setError(null);
      // Opening the thread means the caller has seen it — clears their own badge.
      await apiRequest(`/v1/conversations/${conversationId}/read`, { method: 'PATCH' }).catch(() => undefined);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดข้อความไม่สำเร็จ'));
    }
  }, [conversationId]);

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
        socket.emit('join-conversation', conversationId);
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
    }, [load, conversationId])
  );

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await apiRequest(`/v1/conversations/${conversationId}/messages`, { method: 'POST', body: { message: text } });
      setDraft('');
      await load();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (err) {
      // draft ยังอยู่ในช่องพิมพ์ — กดส่งซ้ำได้เลย
      setError(errorMessageTh(err, 'ส่งข้อความไม่สำเร็จ ข้อความยังอยู่ในช่องพิมพ์ กดส่งอีกครั้งได้'));
    } finally {
      setSending(false);
    }
  };

  if (!thread) {
    return error ? (
      <View style={styles.errorOnly}>
        <EmptyState icon="cloud-offline-outline" title="โหลดข้อความไม่สำเร็จ" hint={error} />
        <PrimaryButton title="ลองใหม่" icon="refresh" onPress={load} />
      </View>
    ) : (
      <LoadingView label="กำลังโหลดข้อความ..." />
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, Platform.OS === 'android' && { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ErrorBanner message={error} />

      <FlatList
        ref={listRef}
        data={thread.messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <EmptyState icon="chatbubble-ellipses-outline" title="เริ่มบทสนทนาได้เลย" hint="พิมพ์ข้อความด้านล่างแล้วกดส่ง" />
        }
        renderItem={({ item, index }) => {
          const mine = item.sender_type === thread.my_side;
          // Only the latest message I sent needs a read label — matches common chat UX
          // (WhatsApp/LINE-style), not one label per bubble.
          const isLastMine = mine && index === thread.messages.length - 1;
          const otherSideLastReadAt = thread.my_side === 'user' ? thread.shop_last_read_at : thread.user_last_read_at;
          const read = isLastMine && !!otherSideLastReadAt && otherSideLastReadAt >= item.created_at;
          return (
            <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
              <View style={[styles.bubble, mine ? [styles.bubbleMine, { backgroundColor: c.primary }] : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.message}</Text>
                <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                  {formatIsoDateTime(item.created_at)}{isLastMine ? (read ? ' · อ่านแล้ว' : ' · ส่งแล้ว') : ''}
                </Text>
              </View>
            </View>
          );
        }}
      />

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  errorOnly: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center', gap: spacing.md },
  listContent: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: radius.badge },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.badge },
  bubbleText: { ...type.body, color: colors.text },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.85)' },
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
