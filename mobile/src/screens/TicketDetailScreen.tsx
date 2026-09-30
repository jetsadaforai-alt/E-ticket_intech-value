import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Share, Image, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { openShopConversation } from '../api/chat';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingView } from '../components/LoadingView';
import { PrimaryButton } from '../components/PrimaryButton';
import { useToast } from '../components/Toast';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { CouponCardHeader } from '../components/CouponCardHeader';
import { QuickRateModal } from '../components/QuickRateModal';
import { getEventReviews } from '../api/reviews';
import { resolveAssetUrl } from '../utils/assetUrl';
import { useQrToken } from '../hooks/useQrToken';
import { useQrScreenMode } from '../hooks/useQrScreenMode';
import { useCountdown } from '../hooks/useCountdown';
import { formatIsoDateTime } from '../utils/datetime';
import { formatDiscountBadge } from '../api/products';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TicketDetail'>;

type TicketDetail = {
  id: string;
  code: string;
  status: string;
  /** ส่งมาจาก backend อยู่แล้ว (routes/tickets.js) — ใช้พาไปหน้า Event เพื่อรีวิว */
  event_id: string;
  event_title: string;
  shop_id: string;
  shop_name: string;
  shop_address: string;
  shop_logo_url: string | null;
  discount_value_baht: string;
  discount_min_baht: number;
  discount_max_baht: number;
  /** Empty = the discount covers the whole shop. */
  products: { id: string; name: string; price_baht: string; image_url: string | null; status: string }[];
  event_end_time: string;
  redemption: { discount_value_baht: string; redeemed_at: string; staff_name: string } | null;
  /** null = ลงทะเบียนรับตั๋วเอง ไม่ได้ผ่านการแชร์ */
  shared_by_name: string | null;
  thumbnail_url: string | null;
};

/** The event photo + shop/status header, shown above the content in every branch
 * (redeemed, dead, active) so a coupon looks the same here as it does in the wallet
 * list — wrapped in its own card chrome since CouponCardHeader itself is chrome-less
 * (NotchCard usually provides that, but this screen has no notch cutout). */
function TicketHeaderCard({ ticket }: { ticket: TicketDetail }) {
  return (
    <View style={styles.headerCard}>
      <CouponCardHeader
        thumbnailUrl={ticket.thumbnail_url}
        imageHeight={140}
        title={ticket.event_title}
        shopName={ticket.shop_name}
        shopLogoUrl={ticket.shop_logo_url}
        badge={{
          text: STATUS_TH[ticket.status] ?? ticket.status,
          tone: ticket.status === 'ISSUED' ? 'success' : ticket.status === 'REDEEMED' ? 'muted' : 'danger',
        }}
      />
    </View>
  );
}

type ViewerTarget = { uri: string; caption: string };

/**
 * What the ticket is good for. Shown in all three render branches — redeemed, dead, and
 * active — because the holder wants to know either way. No products means no restriction.
 */
function ProductScope({
  products,
  onView,
}: {
  products: TicketDetail['products'];
  onView: (target: ViewerTarget) => void;
}) {
  if (!products || products.length === 0) {
    return <Row label="ใช้กับ" value="ใช้ได้กับทุกอย่างในร้าน" />;
  }

  return (
    <View style={styles.scopeBlock}>
      <Text style={styles.scopeLabel}>ใช้กับ</Text>
      {products.map((p) => {
        const photo = resolveAssetUrl(p.image_url);
        return (
          <Pressable
            key={p.id}
            style={styles.scopeRow}
            disabled={!photo}
            onPress={() => photo && onView({ uri: photo, caption: p.name })}
          >
            {photo ? (
              <Image source={{ uri: photo }} style={styles.scopeThumb} />
            ) : (
              <View style={[styles.scopeThumb, styles.scopeThumbEmpty]}>
                <Ionicons name="image-outline" size={16} color={colors.textMuted} />
              </View>
            )}
            <Text style={styles.scopeName} numberOfLines={2}>
              {p.name}
            </Text>
            {p.status === 'archived' && (
              <View style={styles.outOfStockBadge}>
                <Text style={styles.outOfStockBadgeText}>หมด</Text>
              </View>
            )}
            <Text style={styles.scopePrice}>{Number(p.price_baht).toLocaleString()} ฿</Text>
            {photo ? <Ionicons name="expand-outline" size={16} color={colors.textMuted} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

type QuickAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
};

// แถวไอคอนแทนปุ่มเต็มความกว้าง 4 ปุ่มเดิม (แชร์/ติดต่อร้าน/ตั๋วทั้งหมด/ประวัติแชร์) — action
// พวกนี้ไม่เกี่ยวกับการกดรีดีมเลย เลยโชว์ได้ทั้งก่อนและหลังกด "รีดีม" เหมือนกัน มีแค่ QR
// เท่านั้นที่ถูกกั้นไว้
function QuickActions({ items }: { items: QuickAction[] }) {
  return (
    <View style={styles.quickActionsRow}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          style={styles.quickAction}
          onPress={item.onPress}
          disabled={item.loading}
          hitSlop={4}
        >
          <View style={[styles.quickActionBubble, item.loading && styles.quickActionBubbleLoading]}>
            {item.loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name={item.icon} size={20} color={colors.primary} />
            )}
          </View>
          <Text style={styles.quickActionLabel} numberOfLines={2}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// Poll สถานะตั๋วระหว่างที่ยังเป็น ISSUED เพื่อ detect ว่า staff สแกนสำเร็จแล้วหรือยัง — ทำให้หน้านี้
// สลับไปโหมดใบเสร็จได้เองโดยไม่ต้องมี push notification
const POLL_INTERVAL_MS = 4000;

// Matches backend/src/services/qrToken.js TTL_SECONDS — the hook only ever reports seconds
// *remaining*, not the original TTL, so the ring's "full" reference has to be a constant
// kept in sync with that file rather than derived at runtime.
const QR_TTL_SECONDS = 60;
const RING_SIZE = 264;
const QR_SIZE = 204;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function QrRing({ secondsLeft, children }: { secondsLeft: number; children: React.ReactNode }) {
  const fraction = Math.max(0, Math.min(1, secondsLeft / QR_TTL_SECONDS));
  return (
    <View style={styles.ringWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.border}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.primary}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
          // Ring starts at 12 o'clock and drains clockwise, matching the countdown intuition.
          rotation={-90}
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      <View style={styles.ringCenter}>{children}</View>
    </View>
  );
}

const STATUS_TH: Record<string, string> = {
  ISSUED: 'พร้อมใช้',
  REDEEMED: 'ใช้แล้ว',
  CANCELLED: 'ถูกยกเลิก',
  EXPIRED: 'หมดอายุ',
};

export default function TicketDetailScreen({ route, navigation }: Props) {
  const { ticketId } = route.params;
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailedRetryable, setLoadFailedRetryable] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);
  // ปุ่ม "แชร์ตั๋ว" / "ติดต่อร้าน" อยู่ติดกัน ใช้ banner เดียวกัน
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // เห็นตั๋วเปลี่ยนจาก ISSUED -> REDEEMED สดๆ ตอนกำลังเปิดหน้านี้อยู่เท่านั้นถึงจะเด้ง quick-rate
  // popup — เปิดตั๋วเก่าที่ใช้ไปแล้วจาก Wallet ย้อนหลังจะไม่เจอ (ref เริ่มเป็น null เสมอตอน mount)
  const prevStatusRef = useRef<string | null>(null);
  const [quickRateOpen, setQuickRateOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<TicketDetail>(`/v1/tickets/${ticketId}`);
      if (prevStatusRef.current === 'ISSUED' && data.status === 'REDEEMED') {
        try {
          const reviews = await getEventReviews(data.event_id);
          if (!reviews.my_review) setQuickRateOpen(true);
        } catch {
          // เน็ตหลุดตรงเช็คนี้ก็แค่ไม่เด้ง popup — ปุ่ม "ให้คะแนน Event นี้" บนใบเสร็จยังกดเองได้
        }
      }
      prevStatusRef.current = data.status;
      setTicket(data);
      setError(null);
    } catch (err) {
      // 403 = ไม่ใช่ตั๋วของเรา/ไม่มีอยู่จริง — ลองใหม่ไม่มีประโยชน์ ต่างจาก error ทั่วไปที่อาจแค่เน็ตหลุด
      const notFound = err instanceof ApiError && err.status === 403;
      setError(notFound ? 'ไม่พบตั๋วใบนี้ หรือตั๋วไม่ใช่ของคุณ' : errorMessageTh(err, 'โหลดตั๋วไม่สำเร็จ'));
      setLoadFailedRetryable(!notFound);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const isIssued = ticket?.status === 'ISSUED';

  useEffect(() => {
    if (!isIssued) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isIssued, load]);

  const qr = useQrToken(ticketId, isIssued);
  const countdown = useCountdown(qr.expiresAt);
  // ความสว่างเต็ม + กันจอดับ + กันแคปหน้าจอ (เฉพาะ build จริง) ระหว่างที่มี QR ให้สแกน
  useQrScreenMode(isIssued);
  // token ใบปัจจุบันหมดอายุแล้วแต่ใบใหม่ยังมาไม่ถึง (เน็ตช้า/หลุด) — QR ที่ค้างจออยู่สแกนไม่ผ่าน
  // แล้ว ต้องบังไว้ไม่ให้พนักงานสแกนโค้ดที่ตายแล้ว
  const qrExpired = Boolean(qr.token && qr.expiresAt && countdown.secondsLeft <= 0);

  // backend ปฏิเสธ qr-token เพราะตั๋วเปลี่ยนสถานะ — โหลดตั๋วใหม่ทันทีเพื่อสลับหน้าเป็นใบเสร็จ
  useEffect(() => {
    if (qr.ticketNoLongerIssued) load();
  }, [qr.ticketNoLongerIssued, load]);

  const onShare = async () => {
    setActionError(null);
    setSharing(true);
    try {
      const data = await apiRequest<{ share_token: string; expires_at: string }>(`/v1/tickets/${ticketId}/share`, {
        method: 'POST',
      });
      const until = formatIsoDateTime(data.expires_at);
      await Share.share({
        message:
          `เพื่อนแชร์ตั๋ว E-ticket "${ticket?.event_title ?? ''}" ให้คุณ!\n` +
          `เปิดแอป > ตั๋วของฉัน > "รับตั๋วที่เพื่อนแชร์มา" แล้วกรอกรหัสนี้:\n${data.share_token}\n` +
          `(รหัสใช้ได้ถึง ${until})`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(`สร้างรหัสแชร์แล้ว ใช้ได้ถึง ${until} · ตั๋วยังเป็นของคุณจนกว่าเพื่อนจะกดรับ`, 'info');
    } catch (err) {
      setActionError(errorMessageTh(err, 'แชร์ไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setSharing(false);
    }
  };

  const [openingChat, setOpeningChat] = useState(false);
  const onContactShop = async () => {
    if (!ticket) return;
    setActionError(null);
    setOpeningChat(true);
    try {
      const room = await openShopConversation(ticket.shop_id);
      navigation.navigate('ChatRoom', { conversationId: room.id, title: room.shop_name });
    } catch (err) {
      setActionError(errorMessageTh(err, 'เปิดแชทไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setOpeningChat(false);
    }
  };

  const goWallet = () => navigation.navigate('Wallet');

  if (loading) return <LoadingView label="กำลังโหลดตั๋ว..." />;

  if (!ticket) {
    return (
      <View style={styles.errorOnly}>
        <EmptyState
          icon={loadFailedRetryable ? 'cloud-offline-outline' : 'ticket-outline'}
          title={loadFailedRetryable ? 'โหลดตั๋วไม่สำเร็จ' : 'ไม่พบตั๋วใบนี้'}
          hint={error ?? 'ตั๋วอาจไม่ใช่ของคุณ หรือถูกลบไปแล้ว'}
        />
        {loadFailedRetryable ? <PrimaryButton title="ลองใหม่" icon="refresh" onPress={load} /> : null}
        <PrimaryButton title="ดูตั๋วทั้งหมด" variant="secondary" onPress={goWallet} />
      </View>
    );
  }

  // ใช้สิทธิ์แล้ว — หน้าเดียวกันทำหน้าที่เป็นใบเสร็จ
  if (ticket.status === 'REDEEMED') {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <TicketHeaderCard ticket={ticket} />
        <View style={styles.receiptBadge}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={styles.receiptBadgeText}>ใช้สิทธิ์สำเร็จแล้ว</Text>
        </View>
        <View style={styles.card}>
          <Row label="ร้าน" value={ticket.shop_name} />
          <Row label="Event" value={ticket.event_title} />
          <Row label="ส่วนลดที่ใช้" value={`${ticket.redemption?.discount_value_baht ?? ticket.discount_value_baht} บาท`} />
          <ProductScope products={ticket.products} onView={setViewing} />
          <Row label="เวลาที่ใช้สิทธิ์" value={ticket.redemption ? formatIsoDateTime(ticket.redemption.redeemed_at) : '-'} />
          {ticket.redemption?.staff_name ? <Row label="พนักงานที่สแกน" value={ticket.redemption.staff_name} /> : null}
          <Row label="รหัสตั๋ว" value={ticket.code} />
        </View>
        {/* จุดเข้ารีวิวที่ถูกที่สุด — มาถึง branch นี้ได้แปลว่าใช้สิทธิ์จริงแล้ว
            ซึ่งเป็นเงื่อนไขเดียวกับที่ backend ใช้ตัดสินว่าใครรีวิวได้ */}
        <PrimaryButton
          title="ให้คะแนน Event นี้"
          onPress={() => navigation.navigate('EventDetail', { eventId: ticket.event_id })}
        />
        <PrimaryButton title="ดูตั๋วทั้งหมด" variant="secondary" onPress={goWallet} />
        <ImageViewerModal uri={viewing?.uri ?? null} caption={viewing?.caption} onClose={() => setViewing(null)} />
        <QuickRateModal
          visible={quickRateOpen}
          onClose={() => setQuickRateOpen(false)}
          onPick={(rating) => {
            setQuickRateOpen(false);
            navigation.navigate('EventDetail', { eventId: ticket.event_id, prefillRating: rating });
          }}
        />
      </ScrollView>
    );
  }

  // ยกเลิก/หมดอายุ — ไม่มี QR ให้สแกน
  if (ticket.status !== 'ISSUED') {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <TicketHeaderCard ticket={ticket} />
        <View style={styles.inactiveNotice}>
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          <Text style={styles.inactiveNoticeText}>
            ตั๋วใบนี้{STATUS_TH[ticket.status] ?? ticket.status}แล้ว ไม่สามารถใช้สิทธิ์ได้
          </Text>
        </View>
        <View style={styles.card}>
          <Row label="ร้าน" value={ticket.shop_name} />
          <Row label="Event" value={ticket.event_title} />
          <ProductScope products={ticket.products} onView={setViewing} />
          <Row label="รหัสตั๋ว" value={ticket.code} />
        </View>
        <PrimaryButton title="ดูตั๋วทั้งหมด" variant="secondary" onPress={goWallet} />
        <ImageViewerModal uri={viewing?.uri ?? null} caption={viewing?.caption} onClose={() => setViewing(null)} />
      </ScrollView>
    );
  }

  const quickActions: QuickAction[] = [
    {
      key: 'share',
      icon: 'share-social-outline',
      label: 'แชร์ตั๋วให้เพื่อน',
      onPress: onShare,
      loading: sharing,
    },
    {
      key: 'contact',
      icon: 'chatbubble-ellipses-outline',
      label: 'ติดต่อร้าน',
      onPress: onContactShop,
      loading: openingChat,
    },
    { key: 'wallet', icon: 'albums-outline', label: 'ดูตั๋วทั้งหมด', onPress: goWallet },
    {
      key: 'share-history',
      icon: 'time-outline',
      label: 'ประวัติการแชร์',
      onPress: () => navigation.navigate('ShareHistory'),
    },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <ErrorBanner message={error} />

      <View style={styles.unifiedCard}>
        <CouponCardHeader
          thumbnailUrl={ticket.thumbnail_url}
          imageHeight={140}
          title={ticket.event_title}
          shopName={ticket.shop_name}
          shopLogoUrl={ticket.shop_logo_url}
          badge={{ text: STATUS_TH[ticket.status] ?? ticket.status, tone: 'success' }}
        />

        <View style={styles.qrSection}>
          <Text style={styles.qrTitle}>แสดง QR นี้ให้พนักงานสแกน</Text>
          {qr.token ? (
            <QrRing secondsLeft={countdown.secondsLeft}>
              <View style={styles.qrBox} accessible accessibilityLabel="QR สำหรับใช้สิทธิ์ส่วนลด">
                <QRCode value={qr.token} size={QR_SIZE} quietZone={8} backgroundColor="#FFFFFF" color="#000000" />
                {qrExpired ? (
                  <View style={styles.qrOverlay}>
                    <Ionicons name="alert-circle" size={32} color={colors.danger} />
                    <Text style={styles.qrOverlayTitle}>QR หมดอายุ</Text>
                    <Text style={styles.qrOverlayText}>ห้ามใช้ QR นี้ กำลังสร้างใหม่...</Text>
                    <Pressable
                      style={styles.qrOverlayBtn}
                      onPress={qr.retry}
                      accessibilityRole="button"
                      disabled={qr.refreshing}
                    >
                      {qr.refreshing ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="refresh" size={16} color="#fff" />
                      )}
                      <Text style={styles.qrOverlayBtnText}>สร้าง QR ใหม่</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </QrRing>
          ) : qr.error ? (
            <View style={styles.qrPlaceholder}>
              <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
              <Text style={styles.qrOverlayText}>{qr.error}</Text>
              <PrimaryButton title="ลองใหม่" icon="refresh" variant="secondary" onPress={qr.retry} loading={qr.refreshing} />
            </View>
          ) : (
            <View style={styles.qrPlaceholder}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.qrCountdown}>กำลังสร้าง QR...</Text>
            </View>
          )}

          {qr.token && !qrExpired ? (
            qr.refreshing ? (
              <View style={styles.statusPill}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.statusPillText}>กำลังรีเฟรช QR...</Text>
              </View>
            ) : (
              <View style={styles.statusPill} accessibilityLiveRegion="none">
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
                <Text style={styles.statusPillText}>
                  QR นี้ใช้ได้อีก <Text style={styles.statusPillDigits}>{countdown.secondsLeft}</Text> วินาที
                </Text>
              </View>
            )
          ) : null}
          {qr.token && qr.error && !qrExpired ? <Text style={styles.qrWarn}>{qr.error}</Text> : null}

          <View style={styles.codeChip}>
            <Text style={styles.codeChipLabel}>รหัสตั๋ว</Text>
            <Text style={styles.codeChipText} selectable>
              {ticket.code}
            </Text>
          </View>
          <Text style={styles.hintMuted}>
            QR เปลี่ยนใหม่อัตโนมัติทุก 60 วินาทีเพื่อป้องกันการแคปหน้าจอไปใช้ · ปรับความสว่างหน้าจอให้แล้ว
          </Text>
        </View>

        <View style={styles.detailsSection}>
          <Row label="ร้าน" value={ticket.shop_name} />
          <Row label="ที่อยู่" value={ticket.shop_address} />
          <Row label="Event" value={ticket.event_title} />
          <Row label="มูลค่าส่วนลด" value={formatDiscountBadge(ticket.discount_min_baht, ticket.discount_max_baht)} />
          <ProductScope products={ticket.products} onView={setViewing} />
          <Row label="ใช้ได้ถึง" value={formatIsoDateTime(ticket.event_end_time)} />
          {ticket.shared_by_name ? <Row label="ได้รับจาก" value={ticket.shared_by_name} /> : null}
        </View>
      </View>

      <ErrorBanner message={actionError} />

      <QuickActions items={quickActions} />

      {/* กติกาการแชร์ — บอกก่อนกด เพื่อไม่ให้เข้าใจว่าแชร์แล้วตั๋วหายไปทันที */}
      <View style={styles.shareInfo}>
        <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
        <View style={styles.shareInfoBody}>
          <Text style={styles.shareInfoTitle}>แชร์ตั๋วให้เพื่อนทำงานอย่างไร</Text>
          <Text style={styles.shareInfoText}>• รหัสแชร์ใช้ได้ 24 ชั่วโมง</Text>
          <Text style={styles.shareInfoText}>• ตั๋วยังเป็นของคุณ (ใช้เองได้) จนกว่าเพื่อนจะกดรับ</Text>
          <Text style={styles.shareInfoText}>• เพื่อนรับแล้ว ตั๋วจะย้ายไปอยู่กับเพื่อนทันที</Text>
        </View>
      </View>

      <ImageViewerModal uri={viewing?.uri ?? null} caption={viewing?.caption} onClose={() => setViewing(null)} />
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
  scopeBlock: { gap: spacing.xs, paddingVertical: spacing.xs },
  scopeLabel: { ...type.caption, color: colors.textMuted },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.xs,
  },
  scopeThumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surface },
  scopeThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  scopeName: { ...type.bodySmall, flex: 1, color: colors.text },
  outOfStockBadge: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  outOfStockBadgeText: { ...type.captionStrong, color: colors.danger },
  scopePrice: { ...type.bodySmall, color: colors.textMuted },
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  errorOnly: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md, justifyContent: 'center' },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden', // clips CouponCardHeader's square image corners to the card radius
    ...shadows.card,
  },
  unifiedCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden', // clips CouponCardHeader's square image corners to the card radius
    ...shadows.card,
  },
  qrSection: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    minHeight: 300,
    justifyContent: 'center',
  },
  detailsSection: {
    padding: 21,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { alignItems: 'center', justifyContent: 'center' },
  qrTitle: { ...type.subheading, color: colors.text, textAlign: 'center' },
  // Pure white box behind the code regardless of theme — scanners need the contrast
  qrBox: { backgroundColor: '#FFFFFF', borderRadius: radius.md, overflow: 'hidden' },
  qrOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: spacing.md,
  },
  qrOverlayTitle: { ...type.heading, color: colors.danger },
  qrOverlayText: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },
  qrOverlayBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  qrOverlayBtnText: { ...type.label, color: '#fff' },
  qrPlaceholder: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  qrCountdown: { ...type.bodySmall, color: colors.textMuted },
  qrWarn: { ...type.caption, color: colors.warning, textAlign: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 36,
  },
  statusPillText: { ...type.bodySmall, color: colors.primaryDark },
  statusPillDigits: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  codeChipLabel: { ...type.caption, color: colors.textMuted },
  // 'monospace' doesn't exist on iOS — tabular digits + tracking keep the code legible
  codeChipText: { ...type.label, color: colors.text, letterSpacing: 1, fontVariant: ['tabular-nums'] },
  hint: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },
  hintMuted: { ...type.caption, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 21,
    gap: spacing.sm,
    ...shadows.card,
  },
  row: { gap: 0 },
  rowLabel: { ...type.caption, color: colors.textMuted },
  rowValue: { ...type.bodyStrong, color: colors.text },
  receiptBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
    backgroundColor: colors.primaryPill,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  receiptBadgeText: { ...type.subheading, color: colors.statusActiveText },
  inactiveNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  inactiveNoticeText: { ...type.bodyStrong, flex: 1, color: colors.textMuted },
  quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quickAction: { flex: 1, alignItems: 'center', gap: 6 },
  quickActionBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionBubbleLoading: { opacity: 0.6 },
  quickActionLabel: { ...type.caption, color: colors.text, textAlign: 'center' },
  shareInfo: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceLow,
    borderRadius: radius.md,
    padding: 12,
  },
  shareInfoBody: { flex: 1, gap: 2 },
  shareInfoTitle: { ...type.label, color: colors.text },
  shareInfoText: { ...type.caption, color: colors.textMuted },
});
