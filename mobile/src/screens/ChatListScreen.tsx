import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/AppText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import BottomTabBar from '../components/BottomTabBar';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { SkeletonList } from '../components/Skeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { useMode } from '../context/ModeContext';
import { formatIsoDateTime } from '../utils/datetime';
import { colors, radius, shadows, spacing, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatList'>;

// The two sides return different identity fields for the counterpart; everything
// else about the row is the same, so one screen renders both inboxes.
type CustomerRoom = {
  id: string;
  shop_id: string;
  shop_name: string;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
};

type ShopRoom = {
  id: string;
  customer_name: string;
  customer_phone: string;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
};

type Row = { id: string; title: string; subtitle: string | null; lastMessageAt: string; unread: number };

export default function ChatListScreen({ navigation }: Props) {
  const { isLoggedIn } = useAuth();
  const { mode, vendorShopId, staffShopId } = useMode();
  const shopId = mode === 'vendor' ? vendorShopId : mode === 'staff' ? staffShopId : null;
  // เข้าได้ทั้ง 3 โหมด (vendor/staff/customer) — avatar วงกลมด้านล่างใช้สี primary ต้องอ่าน
  // ตามโหมดจริง ไม่ hardcode
  const c = useColors();
  const [rows, setRows] = useState<Row[]>([]);
  // ครั้งแรกเท่านั้น — เดิมไม่มี ทำให้ข้อความ "ยังไม่มีแชท" โผล่ระหว่างรอข้อมูล
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The chat tab is visible to guests (Home/Event browsing needs no account), but
    // every chat endpoint is authed — ask for login instead of showing a failed fetch.
    if (!isLoggedIn) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      if (shopId) {
        const data = await apiRequest<ShopRoom[]>(`/v1/shops/${shopId}/conversations`);
        setRows(
          data.map((c) => ({
            id: c.id,
            title: c.customer_name,
            subtitle: c.last_message,
            lastMessageAt: c.last_message_at,
            unread: c.unread_count,
          }))
        );
      } else {
        const data = await apiRequest<CustomerRoom[]>('/v1/conversations');
        setRows(
          data.map((c) => ({
            id: c.id,
            title: c.shop_name,
            subtitle: c.last_message,
            lastMessageAt: c.last_message_at,
            unread: c.unread_count,
          }))
        );
      }
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดรายการแชทไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [shopId, isLoggedIn]);

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

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="chatbubbles-outline"
            title="เข้าสู่ระบบเพื่อคุยกับร้านค้า"
            hint="สอบถามร้านเรื่องส่วนลด เวลาเปิด หรือสินค้าได้โดยตรง"
          />
          <View style={styles.loginButtonWrap}>
            <PrimaryButton
              title="เข้าสู่ระบบ"
              onPress={() => navigation.navigate('AuthChoice', { returnTo: { kind: 'return_to', screen: 'ChatList' } })}
            />
          </View>
        </View>
        <BottomTabBar active="ChatList" navigation={navigation} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.flex}>
          <SkeletonList count={5} />
        </View>
      ) : (
        <FlatList
          style={styles.flex}
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.primary]} tintColor={c.primary} />
          }
          ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={load} /> : null}
          ListEmptyComponent={
            error ? null : shopId ? (
              <EmptyState icon="chatbubbles-outline" title="ยังไม่มีลูกค้าทักเข้ามา" hint="ข้อความจากลูกค้าจะแสดงที่นี่" />
            ) : (
              <EmptyState
                icon="chatbubbles-outline"
                title="ยังไม่มีแชท"
                hint="กด 'ติดต่อร้าน' ในหน้า Event หรือหน้าตั๋ว เพื่อเริ่มคุยกับร้าน"
                actionLabel="ดู Event"
                onAction={() => navigation.replace('Home')}
              />
            )
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('ChatRoom', { conversationId: item.id, title: item.title })}
              accessibilityRole="button"
              accessibilityLabel={
                item.unread > 0 ? `${item.title} ข้อความใหม่ ${item.unread}` : item.title
              }
            >
              <View style={[styles.avatar, { backgroundColor: c.primarySoft }]}>
                <Text style={[styles.avatarText, { color: c.primary }]}>{item.title.charAt(0)}</Text>
              </View>
              <View style={styles.cardTextWrap}>
                <View style={styles.titleRow}>
                  <Text style={[styles.cardTitle, item.unread > 0 && styles.cardTitleUnread]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.cardTime}>{formatIsoDateTime(item.lastMessageAt)}</Text>
                </View>
                <Text style={[styles.cardPreview, item.unread > 0 && styles.cardPreviewUnread]} numberOfLines={1}>
                  {item.subtitle ?? 'ยังไม่มีข้อความ'}
                </Text>
              </View>
              {item.unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      <BottomTabBar active="ChatList" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  listContent: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  loginButtonWrap: { paddingHorizontal: spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  cardTextWrap: { flex: 1, gap: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...type.bodyStrong, color: colors.text, flex: 1 },
  cardTitleUnread: { fontWeight: '700' },
  cardPreview: { ...type.bodySmall, color: colors.textMuted },
  cardPreviewUnread: { color: colors.text, fontWeight: '600' },
  cardTime: { ...type.caption, color: colors.textMuted },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '700' },
});
