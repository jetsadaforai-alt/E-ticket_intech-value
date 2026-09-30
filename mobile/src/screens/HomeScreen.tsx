import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ScrollView, ImageBackground } from 'react-native';
import { Text } from '../components/AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { EventCardSkeleton, Skeleton } from '../components/Skeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import BottomTabBar from '../components/BottomTabBar';
import { EventCard, type EventListItem } from '../components/EventCard';
import { formatDiscountBadge } from '../api/products';
import { useAuth } from '../context/AuthContext';
import { useUnreadNotifications } from '../hooks/useUnreadNotifications';
import { resolveAssetUrl } from '../utils/assetUrl';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// Backend Event.category values (backend/prisma/schema.prisma) — 'All Events' has no
// backend counterpart, it just means "no category filter" client-side.
const CATEGORY_CHIPS: { label: string; category: string | null }[] = [
  { label: 'ทั้งหมด', category: null },
  { label: 'อาหารและเครื่องดื่ม', category: 'food_drink' },
  { label: 'ดนตรี', category: 'music' },
  { label: 'เวิร์กช็อป', category: 'workshops' },
];

// เนื้อหาข้างในการ์ด spotlight — เหมือนกันทั้งกรณีมีรูป (วางทับ ImageBackground) และไม่มีรูป
// (วางทับ gradient เปล่า) แยกออกมาเพื่อไม่ต้องเขียนซ้ำสองที่
function SpotlightContent({ item }: { item: EventListItem }) {
  return (
    <>
      <View style={styles.spotlightBadge}>
        <Text style={styles.spotlightBadgeText}>แนะนำวันนี้</Text>
      </View>
      <View style={styles.spotlightBottom}>
        <Text style={styles.spotlightTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.spotlightShop} numberOfLines={1}>{item.shop_name}</Text>
        <View style={styles.spotlightRow}>
          <View style={styles.spotlightDiscount}>
            <Text style={styles.spotlightDiscountText}>{formatDiscountBadge(item.discount_min_baht, item.discount_max_baht)}</Text>
          </View>
          <Text style={styles.spotlightCta}>ดูเลย ›</Text>
        </View>
      </View>
    </>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true); // ครั้งแรกเท่านั้น — แยกจาก refreshing (pull-to-refresh)
  // เปลี่ยนหมวดแล้วรอข้อมูล — เดิมรายการเก่าค้างอยู่เฉยๆ ไม่มีสัญญาณว่ากำลังโหลด
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChip, setActiveChip] = useState(CATEGORY_CHIPS[0].label);
  const { unreadCount } = useUnreadNotifications();
  const { me, isLoggedIn } = useAuth(); // me เป็น null เมื่อเป็น guest — Home เข้าได้โดยไม่ต้อง login
  // Tapping chips quickly can let an older request land after a newer one; only the
  // latest request is allowed to update the list.
  const requestSeq = useRef(0);
  const firstLoadDone = useRef(false);

  const load = useCallback(async (category: string | null) => {
    const seq = ++requestSeq.current;
    try {
      const query = category ? `?category=${encodeURIComponent(category)}` : '';
      const data = await apiRequest<EventListItem[]>(`/v1/events${query}`, { auth: false });
      if (seq !== requestSeq.current) return;
      setEvents(data);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(errorMessageTh(err, 'โหลดรายการ Event ไม่สำเร็จ'));
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setSwitching(false);
      }
    }
  }, []);

  const activeCategory = CATEGORY_CHIPS.find((c) => c.label === activeChip)?.category ?? null;

  useEffect(() => {
    if (firstLoadDone.current) setSwitching(true);
    firstLoadDone.current = true;
    load(activeCategory);
  }, [load, activeCategory]);

  useLayoutEffect(() => {
    // Title ในแถบ nav เดิมเคยเป็นแค่ "E-Ticket" เฉยๆ — ตอนนี้คำทักทายจริงๆ ย้ายไปอยู่ใน
    // hero block ของ body แทน (ใส่ subtitle ไม่ได้ถ้าอยู่ในแถบ nav) แถบ nav นี้จึงเหลือแค่โลโก้
    // เล็กๆ + ปุ่มกระดิ่งไว้เหมือนเดิม
    navigation.setOptions({
      title: 'E-ticket',
      headerStyle: { backgroundColor: colors.background },
      headerTitleStyle: { color: colors.primary, fontWeight: '700', fontSize: 16 },
      // Guest ยังไม่มีอะไรให้แจ้งเตือน (useUnreadNotifications ข้าม fetch ไปแล้วถ้าไม่ login) —
      // เอาพื้นที่นี้ไปเป็นทางเข้า Landing (สมัคร/เข้าสู่ระบบ) แทนกระดิ่งเปล่าๆ
      headerRight: () =>
        isLoggedIn ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('NotificationCenter')}
            style={styles.bellButton}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `การแจ้งเตือน ยังไม่อ่าน ${unreadCount}` : 'การแจ้งเตือน'}
          >
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => navigation.navigate('Landing')}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={styles.loginCta}
            accessibilityRole="button"
          >
            <Text style={styles.loginCtaText}>เข้าสู่ระบบ</Text>
          </TouchableOpacity>
        ),
    });
  }, [navigation, unreadCount, isLoggedIn]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(activeCategory);
    setRefreshing(false);
  };

  // แยก 3 สถานะให้ชัด: กำลังโหลดครั้งแรก (ไม่ใช่ "ยังไม่มี Event"), โหลดพังจริง (มี error
  // banner + ปุ่มลองใหม่ ไม่ใช่ unhandled rejection แบบเงียบๆ), และว่างจริง (ตาม design เดิม)
  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.skeletonWrap}>
        <Skeleton width="55%" height={26} />
        <Skeleton width="80%" height={16} style={{ marginBottom: spacing.sm }} />
        <Skeleton height={176} rounded={radius.card} style={{ marginBottom: spacing.md }} />
        <EventCardSkeleton />
      </View>
    );
  } else if (error && events.length === 0) {
    body = (
      <View style={styles.errorWrap}>
        <EmptyState icon="cloud-offline-outline" title="โหลดรายการ Event ไม่สำเร็จ" hint={error} />
        <PrimaryButton
          title="ลองใหม่"
          icon="refresh"
          onPress={() => {
            setLoading(true);
            return load(activeCategory);
          }}
        />
      </View>
    );
  } else {
    const firstName = me?.name?.trim().split(/\s+/)[0];
    // Spotlight การ์ดใหญ่ด้านบนคือ event ที่มีคนกดรับ (claimed_count) มากที่สุด — ไม่ใช่แค่ event
    // ที่สร้างล่าสุด — และต้องโชว์ซ้ำใน list ปกติด้านล่างด้วย ไม่ตัดออก (ผู้ใช้ต้องเห็นทั้ง 2 แบบ)
    const spotlightEvent =
      events.length > 0
        ? events.reduce((top, e) => (e.claimed_count > top.claimed_count ? e : top), events[0])
        : null;
    // ระหว่างเปลี่ยนหมวด แสดงโครงการ์ดแทนรายการเก่า (ส่วนหัว + chip ยังอยู่ให้กดต่อได้)
    const listEvents = switching ? [] : events;
    const activeLabel = CATEGORY_CHIPS.find((c) => c.label === activeChip)?.label;

    body = (
      <FlatList
        data={listEvents}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.greetingRow}>
              <Text style={styles.greetingTitle}>{firstName ? `สวัสดี ${firstName} 👋` : 'สวัสดี 👋'}</Text>
              <Text style={styles.greetingSub}>มาเลือกคูปองส่วนลดร้านโปรดของคุณกันเถอะ</Text>
            </View>

            {error ? <ErrorBanner message={error} onRetry={() => load(activeCategory)} /> : null}

            {spotlightEvent && !switching && (
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.spotlightWrap}
                onPress={() => navigation.navigate('EventDetail', { eventId: spotlightEvent.id })}
                accessibilityRole="button"
                accessibilityLabel={`แนะนำวันนี้: ${spotlightEvent.title} ร้าน ${spotlightEvent.shop_name}`}
              >
                {spotlightEvent.thumbnail_url ? (
                  <ImageBackground
                    source={{ uri: resolveAssetUrl(spotlightEvent.thumbnail_url) ?? undefined }}
                    style={styles.spotlightBg}
                    imageStyle={styles.spotlightImageRadius}
                  >
                    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.spotlightGradient}>
                      <SpotlightContent item={spotlightEvent} />
                    </LinearGradient>
                  </ImageBackground>
                ) : (
                  <LinearGradient
                    colors={[colors.primary, colors.primaryDark]}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.spotlightBg, styles.spotlightGradient]}
                  >
                    <SpotlightContent item={spotlightEvent} />
                  </LinearGradient>
                )}
              </TouchableOpacity>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent} >
              {CATEGORY_CHIPS.map((chip) => {
                const isActive = chip.label === activeChip;
                return (
                  <TouchableOpacity
                    key={chip.label}
                    onPress={() => setActiveChip(chip.label)}
                    style={[styles.chip, isActive && styles.chipActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{chip.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          switching ? (
            <EventCardSkeleton />
          ) : error ? null : activeCategory ? (
            <EmptyState
              icon="pricetags-outline"
              title={`ยังไม่มี Event ในหมวด${activeLabel ?? 'นี้'}`}
              hint="ลองดูหมวดอื่น หรือกลับมาใหม่ภายหลัง"
              actionLabel="ดูทั้งหมด"
              onAction={() => setActiveChip(CATEGORY_CHIPS[0].label)}
            />
          ) : (
            <EmptyState
              icon="ticket-outline"
              title="ยังไม่มี Event ในระบบตอนนี้"
              hint="ดึงหน้าจอลงเพื่อโหลดใหม่ หรือกลับมาดูภายหลัง"
            />
          )
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <EventCard item={item} onPress={() => navigation.navigate('EventDetail', { eventId: item.id })} />
        )}
      />
    );
  }

  return (
    <View style={styles.container}>
      {body}
      <BottomTabBar active="Home" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  skeletonWrap: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  errorWrap: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },

  bellButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  bellBadge: {
    position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.background,
  },
  bellBadgeText: { color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: '700' },
  loginCta: {
    backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md,
    minHeight: 36, justifyContent: 'center',
  },
  loginCtaText: { ...type.label, color: '#fff' },

  // listContent (ด้านล่าง) ให้ padding แนวนอนกับทั้ง FlatList อยู่แล้ว รวม header นี้ด้วย —
  // ไม่ใส่ paddingHorizontal ซ้ำที่นี่ ไม่งั้น header จะแคบกว่าการ์ด event ด้านล่าง
  headerBlock: { marginBottom: spacing.sm, gap: spacing.md },
  greetingRow: {},
  greetingTitle: { ...type.title, color: colors.text, letterSpacing: -0.3 },
  greetingSub: { ...type.bodySmall, color: colors.textMuted },

  spotlightWrap: { borderRadius: radius.card, ...shadows.card },
  spotlightBg: { height: 176, borderRadius: radius.card, overflow: 'hidden' },
  spotlightImageRadius: { borderRadius: radius.card },
  spotlightGradient: { flex: 1, justifyContent: 'space-between', padding: spacing.md },
  spotlightBadge: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2,
  },
  spotlightBadgeText: { ...type.captionStrong, color: '#fff', letterSpacing: 0.3 },
  spotlightBottom: { gap: 2 },
  spotlightTitle: { ...type.heading, color: '#fff' },
  spotlightShop: { ...type.bodySmall, color: 'rgba(255,255,255,0.9)' },
  spotlightRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  spotlightDiscount: { backgroundColor: colors.dealAccentDark, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  spotlightDiscountText: { ...type.label, color: '#fff' },
  spotlightCta: { ...type.label, color: '#fff' },

  chipsRow: { marginHorizontal: -spacing.lg },
  chipsContent: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    minHeight: touch.min, justifyContent: 'center',
    paddingHorizontal: spacing.md, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong,
  },
  chipActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },
  chipText: { ...type.label, color: colors.text },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});
