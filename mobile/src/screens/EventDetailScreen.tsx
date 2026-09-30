import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Image, StyleSheet, Alert, Pressable, Linking, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Text } from '../components/AppText';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest } from '../api/client';
import { errorMessageTh } from '../api/errorMessages';
import { resolveAssetUrl } from '../utils/assetUrl';
import { openShopConversation } from '../api/chat';
import { useAuth } from '../context/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { PrimaryButton } from '../components/PrimaryButton';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { GradeRating } from '../components/GradeRating';
import { FormField } from '../components/FormField';
import { getEventReviews, submitReview, deleteMyReview, uploadReviewPhoto, type EventReviews } from '../api/reviews';
import { discountedPrice, formatDiscountBadge } from '../api/products';
import { formatIsoDateTime, formatIsoDateOnly } from '../utils/datetime';
import { toJpegAsset, type UploadableImage } from '../utils/imageUpload';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, shadows, spacing, touch, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

type EventDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startTime: string;
  endTime: string;
  shop: { id: string; name: string; address: string };
  images: { id: string; imageUrl: string }[];
  redemptionWindow: {
    validFrom: string | null;
    validUntil: string | null;
    slots: { dayOfWeek: string; startTime: string; endTime: string }[];
  } | null;
  ticketBatch: { totalQty: number; remainingCount: number; discountValueBaht: string } | null;
  discount_min_baht: number;
  discount_max_baht: number;
  /** Empty = the discount covers the whole shop, which is the default. */
  products: { id: string; name: string; priceBaht: string; imageUrl: string | null; status: string; discount_value_baht: number }[];
  /** Whether the current caller already holds a ticket for this event — false for guests
   * and for a logged-in user who hasn't claimed one yet. Persists across app restarts
   * (backend-computed), unlike the local `justClaimed` flag below. */
  already_claimed: boolean;
};

const DAY_TH: Record<string, string> = { MON: 'จ', TUE: 'อ', WED: 'พ', THU: 'พฤ', FRI: 'ศ', SAT: 'ส', SUN: 'อา' };

// event ที่ไม่ active แล้ว (เช่นเข้ามาจาก link เก่า) ต้องเห็นเหตุผลชัดเจน ไม่ใช่หน้าที่ดูเหมือนยังกดรับได้
const INACTIVE_MESSAGES: Record<string, string> = {
  cancelled: 'Event นี้ถูกยกเลิกแล้ว ไม่สามารถลงทะเบียนรับตั๋วได้',
  expired: 'Event นี้หมดเวลาแล้ว ไม่สามารถลงทะเบียนรับตั๋วได้',
  banned: 'Event นี้ถูกระงับโดยผู้ดูแลระบบ ตั๋วที่แจกไปแล้วใช้ไม่ได้',
};

export default function EventDetailScreen({ route, navigation }: Props) {
  const { eventId, prefillRating } = route.params;
  // รูปเดิม hardcode width 380 — เพี้ยนบนจอที่แคบ/กว้างกว่านั้น (iPhone SE 375pt, บาง
  // Android 360-430pt) ทำให้ paging เลื่อนไม่ตรงรูปพอดีจอ ใช้ความกว้างจอจริงแทน
  const { width: screenWidth } = useWindowDimensions();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [viewing, setViewing] = useState<{ uri: string; caption: string } | null>(null);
  const { isLoggedIn } = useAuth();
  const toast = useToast();

  const [reviews, setReviews] = useState<EventReviews | null>(null);
  const [reviewsLoadError, setReviewsLoadError] = useState<string | null>(null);
  const [deletingReview, setDeletingReview] = useState(false);
  const insets = useSafeAreaInsets();
  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState('');
  const [draftPhoto, setDraftPhoto] = useState<UploadableImage | null>(null);
  const [editingReview, setEditingReview] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // ปุ่มลงทะเบียน/ติดต่อร้านอยู่ติดกันล่างสุด ใช้ banner เดียวกัน — เห็นตำแหน่งเดียวกับปุ่มที่กด
  const [actionError, setActionError] = useState<string | null>(null);

  // Claim-flow state machine: idle → confirmLoginRequired → (cancel|login) |
  // idle → confirmClaim → (cancel|claim) → successChoice → (wallet|stay-with-gray-button)
  const [claimStep, setClaimStep] = useState<'idle' | 'confirmLoginRequired' | 'confirmClaim' | 'successChoice'>('idle');
  // Local override so the button goes gray immediately after claiming, without waiting
  // for the background `load()` refresh of `already_claimed` to land.
  const [justClaimed, setJustClaimed] = useState(false);

  const onViewMap = () => {
    if (!event) return;
    const query = encodeURIComponent(`${event.shop.name} ${event.shop.address}`);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const onContactShop = async () => {
    if (!event) return;
    if (!isLoggedIn) {
      navigation.navigate('AuthChoice', {
        returnTo: { kind: 'contact_shop', eventId, shopId: event.shop.id },
      });
      return;
    }
    setActionError(null);
    setOpeningChat(true);
    try {
      const room = await openShopConversation(event.shop.id);
      navigation.navigate('ChatRoom', { conversationId: room.id, title: room.shop_name });
    } catch (err) {
      setActionError(errorMessageTh(err, 'เปิดแชทไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setOpeningChat(false);
    }
  };

  const load = useCallback(async () => {
    try {
      // Was `auth: false` — harmless before, but that meant a logged-in user's token
      // never reached this endpoint at all. Now that the backend personalizes
      // already_claimed when a valid token is present (attachCallerIfPresent), this
      // must send it when available. apiRequest's default only *attaches* a token
      // that exists (../api/client.ts) — a guest with no token still sends none,
      // so guest access here is unaffected.
      const data = await apiRequest<EventDetail>(`/v1/events/${eventId}`);
      setEvent(data);
      setError(null);
    } catch (err) {
      setError(errorMessageTh(err, 'โหลดรายละเอียด Event ไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // Reviews load alongside the event but never block it — a failure here shows a small
  // retryable notice inside the review card instead of turning the whole page into an
  // error (it used to make the section vanish silently).
  const loadReviews = useCallback(async () => {
    try {
      setReviews(await getEventReviews(eventId));
      setReviewsLoadError(null);
    } catch (err) {
      setReviewsLoadError(errorMessageTh(err, 'โหลดรีวิวไม่สำเร็จ'));
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadReviews();
    }, [load, loadReviews])
  );

  // มาจาก popup รีวิวเร็วๆ ใน TicketDetailScreen (เลือกเกรดไว้แล้ว) — เซ็ต draftRating ให้ทันที
  // ที่ reviews โหลดเสร็จรอบแรก ไม่ทับกรณีมีรีวิวอยู่แล้วหรือรีวิวไม่ได้
  useEffect(() => {
    if (prefillRating && reviews?.can_review && !reviews.my_review) {
      setDraftRating(prefillRating);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews]);

  const onSaveReview = async () => {
    setReviewError(null);
    if (draftRating < 1) {
      setReviewError('เลือกเกรดก่อนถึงจะส่งรีวิวได้');
      return;
    }
    setSavingReview(true);
    try {
      await submitReview(eventId, { rating: draftRating, comment: draftComment.trim() || undefined });
      // แนบรูป (ถ้าเลือกไว้) หลังรีวิวถูกบันทึกสำเร็จแล้วเท่านั้น — เอ็นด์พอยต์รูปต้องมีรีวิวอยู่ก่อน
      if (draftPhoto) {
        try {
          await uploadReviewPhoto(eventId, draftPhoto);
        } catch {
          setReviewError('บันทึกรีวิวแล้ว แต่แนบรูปไม่สำเร็จ ลองแนบใหม่ได้จากการแก้ไขรีวิว');
        }
      }
      setEditingReview(false);
      setDraftRating(0);
      setDraftComment('');
      setDraftPhoto(null);
      await Promise.all([loadReviews(), load()]);
      toast(editingReview ? 'บันทึกการแก้ไขรีวิวแล้ว' : 'ส่งรีวิวแล้ว ขอบคุณที่แบ่งปัน');
    } catch (err) {
      setReviewError(errorMessageTh(err, 'บันทึกรีวิวไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setSavingReview(false);
    }
  };

  const onPickReviewPhoto = async () => {
    setReviewError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setReviewError('ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled) return;
      setDraftPhoto(await toJpegAsset(result.assets[0]));
    } catch (err) {
      // Picker/conversion errors are native English messages — never shown to users.
      console.warn('Review photo pick failed:', err);
      setReviewError('เลือกรูปไม่สำเร็จ ลองเลือกรูปอื่นหรือลองใหม่อีกครั้ง');
    }
  };

  const onStartEditReview = () => {
    setReviewError(null);
    setDraftRating(reviews?.my_review?.rating ?? 0);
    setDraftComment(reviews?.my_review?.comment ?? '');
    setDraftPhoto(null); // รูปเดิม (ถ้ามี) ยังอยู่จนกว่าจะเลือกรูปใหม่มาแทน
    setEditingReview(true);
  };

  // ตัวยืนยันก่อนลบยังเป็น Alert เหมือนเดิม — เป็น confirm dialog ไม่ใช่ error display ต่างขอบเขต
  // กับ pattern inline-banner ที่คุมแค่การแสดงผล error/success
  const onDeleteReview = () => {
    if (deletingReview) return;
    Alert.alert('ลบรีวิว', 'ลบรีวิวของคุณออกจาก Event นี้?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          setReviewError(null);
          setDeletingReview(true);
          try {
            await deleteMyReview(eventId);
            setEditingReview(false);
            await Promise.all([loadReviews(), load()]);
            toast('ลบรีวิวแล้ว');
          } catch (err) {
            setReviewError(errorMessageTh(err, 'ลบรีวิวไม่สำเร็จ ลองใหม่อีกครั้ง'));
          } finally {
            setDeletingReview(false);
          }
        },
      },
    ]);
  };

  // Entry point for the "รับคูปอง" button — just opens the right first dialog.
  const onClaimPress = () => {
    setClaimStep(isLoggedIn ? 'confirmClaim' : 'confirmLoginRequired');
  };

  const onConfirmLogin = () => {
    setClaimStep('idle');
    // AuthChoice (register_event) lands back on this same EventDetail screen — still
    // unclaimed — after a successful login or signup (see OtpScreen.tsx), rather than
    // going straight to Login.
    navigation.navigate('AuthChoice', { returnTo: { kind: 'register_event', eventId } });
  };

  const onConfirmClaim = async () => {
    setClaimStep('idle');
    setActionError(null);
    setRegistering(true);
    try {
      await apiRequest<{ id: string }>(`/v1/events/${eventId}/register`, { method: 'POST' });
      setJustClaimed(true);
      setClaimStep('successChoice');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      load(); // sync already_claimed/จำนวนคงเหลือในเบื้องหลัง ไม่บล็อก dialog ที่กำลังโชว์
    } catch (err) {
      setActionError(errorMessageTh(err, 'รับตั๋วไม่สำเร็จ ลองใหม่อีกครั้ง'));
      await load(); // sync จำนวนคงเหลือ/สถานะใหม่ (เช่นเพิ่งเต็มพอดี)
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Skeleton height={240} rounded={0} />
        <View style={[styles.body, { gap: spacing.sm }]}>
          <Skeleton width="75%" height={28} />
          <Skeleton height={180} rounded={radius.card} />
          <Skeleton height={120} rounded={radius.card} />
        </View>
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.errorOnly}>
        <EmptyState
          icon={error ? 'cloud-offline-outline' : 'search-outline'}
          title={error ? 'โหลดรายละเอียด Event ไม่สำเร็จ' : 'ไม่พบ Event นี้'}
          hint={error ?? 'Event อาจถูกลบไปแล้ว'}
        />
        {error ? (
          <PrimaryButton
            title="ลองใหม่"
            icon="refresh"
            onPress={() => {
              setLoading(true);
              return load();
            }}
          />
        ) : null}
      </View>
    );
  }

  const remaining = event.ticketBatch?.remainingCount ?? 0;
  const soldOut = remaining <= 0;
  const inactiveMessage = event.status !== 'active' ? (INACTIVE_MESSAGES[event.status] ?? 'Event นี้ไม่เปิดใช้งานแล้ว') : null;
  // API-backed flag (persists across restarts) OR the local flag set the instant a claim
  // just succeeded, before the background load() refresh has landed.
  const alreadyClaimed = event.already_claimed || justClaimed;
  const hasWindow =
    event.redemptionWindow &&
    (event.redemptionWindow.validFrom || event.redemptionWindow.validUntil || event.redemptionWindow.slots.length > 0);

  const claimTitle = inactiveMessage
    ? 'ปิดรับลงทะเบียนแล้ว'
    : alreadyClaimed
    ? 'คุณรับตั๋วใบนี้แล้ว'
    : soldOut
    ? 'ตั๋วเต็มแล้ว'
    : 'รับตั๋ว';
  const claimHint =
    soldOut && !inactiveMessage && !alreadyClaimed
      ? 'ขออภัย สิทธิ์ในการรับตั๋วนี้ครบจำนวนแล้ว'
      : alreadyClaimed
      ? 'ดูตั๋วและ QR ได้ที่ "ตั๋วของฉัน"'
      : null;

  return (
    <View style={styles.container}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      <View>
        {event.images.length > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {event.images.map((img) => (
              <Image key={img.id} source={{ uri: resolveAssetUrl(img.imageUrl) ?? undefined }} style={[styles.heroImage, { width: screenWidth }]} />
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.heroImage, styles.heroPlaceholder, { width: screenWidth }]}>
            <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            <Text style={styles.placeholderText}>ไม่มีรูป</Text>
          </View>
        )}
        {soldOut ? (
          <View style={styles.soldOutBadge}>
            <Ionicons name="close-circle" size={16} color="#fff" />
            <Text style={styles.soldOutBadgeText}>สิทธิ์เต็มแล้ว</Text>
          </View>
        ) : null}
        {event.images.length > 1 ? (
          <View style={styles.imageCount}>
            <Ionicons name="images-outline" size={14} color="#fff" />
            <Text style={styles.imageCountText}>{event.images.length} รูป · ปัดดูได้</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <ErrorBanner message={error} />

        <Text style={styles.title}>{event.title}</Text>
        {inactiveMessage ? (
          <View style={styles.inactiveNotice}>
            <Ionicons name="information-circle" size={20} color={colors.warning} />
            <Text style={styles.inactiveNoticeText}>{inactiveMessage}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Row label="ร้าน" value={event.shop.name} />
          <Row label="ที่อยู่" value={event.shop.address} />
          <Row label="ช่วงเวลา Event" value={`${formatIsoDateTime(event.startTime)} - ${formatIsoDateTime(event.endTime)}`} />
          <Row label="มูลค่าส่วนลด" value={formatDiscountBadge(event.discount_min_baht, event.discount_max_baht)} />
          <Row
            label="จำนวนคงเหลือ"
            value={soldOut ? 'เต็มแล้ว' : `${remaining} / ${event.ticketBatch?.totalQty ?? 0} ใบ`}
            valueColor={soldOut ? colors.danger : undefined}
          />
          <PrimaryButton title="ดูแผนที่ร้าน" icon="map-outline" variant="secondary" onPress={onViewMap} />
        </View>

        {event.description ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>รายละเอียด</Text>
            <Text style={styles.description}>{event.description}</Text>
          </View>
        ) : null}

        {event.products?.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>ใช้ได้กับสินค้า</Text>
            <Text style={styles.description}>ส่วนลดนี้ใช้ได้เฉพาะรายการด้านล่าง</Text>
            {event.products.map((p) => {
              const after = discountedPrice(p.priceBaht, p.discount_value_baht);
              const photo = resolveAssetUrl(p.imageUrl);
              return (
                <Pressable
                  key={p.id}
                  style={styles.productRow}
                  // Only a product that has a photo is worth tapping — otherwise the press
                  // would open an empty viewer and read as broken.
                  disabled={!photo}
                  onPress={() => photo && setViewing({ uri: photo, caption: p.name })}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.productThumb} />
                  ) : (
                    <View style={[styles.productThumb, styles.productThumbEmpty]}>
                      <Ionicons name="image-outline" size={18} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>
                      {p.name}
                    </Text>
                    {photo ? <Text style={styles.tapHint}>แตะเพื่อดูรูป</Text> : null}
                  </View>
                  <View style={styles.productPrices}>
                    <Text style={styles.priceBefore}>{Number(p.priceBaht).toLocaleString()}</Text>
                    <Text style={styles.priceAfter}>{after.toLocaleString()} ฿</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* เงื่อนไขนี้ไม่กระทบการลงทะเบียนรับตั๋ว — บังคับเฉพาะตอนพนักงานสแกนใช้สิทธิ์ */}
        {hasWindow ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>เงื่อนไขการใช้สิทธิ์</Text>
            {event.redemptionWindow!.validFrom || event.redemptionWindow!.validUntil ? (
              <Text style={styles.description}>
                ใช้สิทธิ์ได้: {formatIsoDateOnly(event.redemptionWindow!.validFrom) || 'ไม่จำกัดวันเริ่ม'} ถึง{' '}
                {formatIsoDateOnly(event.redemptionWindow!.validUntil) || 'ไม่จำกัดวันสิ้นสุด'}
              </Text>
            ) : null}
            {event.redemptionWindow!.slots.length > 0 ? (
              <Text style={styles.description}>
                ช่วงเวลา:{' '}
                {event.redemptionWindow!.slots
                  .map((s) => `${DAY_TH[s.dayOfWeek] ?? s.dayOfWeek} ${s.startTime}-${s.endTime}`)
                  .join(', ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!reviews && reviewsLoadError ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>รีวิว</Text>
            <ErrorBanner message={reviewsLoadError} onRetry={loadReviews} />
          </View>
        ) : null}

        {reviews ? (
          <View style={styles.card}>
            <ErrorBanner message={reviewError} />
            <View style={styles.reviewHead}>
              <Text style={styles.sectionTitle}>รีวิว</Text>
              {reviews.summary.count > 0 ? (
                <View style={styles.reviewScore}>
                  <GradeRating value={reviews.summary.average ?? 0} size={24} />
                  <Text style={styles.reviewCount}>({reviews.summary.count})</Text>
                </View>
              ) : null}
            </View>

            {reviews.shop_summary.count > 0 ? (
              <View style={styles.shopAverageRow}>
                <Text style={styles.shopAverage}>ทั้งร้าน</Text>
                <GradeRating value={reviews.shop_summary.average ?? 0} size={16} />
                <Text style={styles.shopAverage}>จาก {reviews.shop_summary.count} รีวิว</Text>
              </View>
            ) : null}

            {/* รีวิวของเราเอง — โชว์แยกไว้บนสุด พร้อมสลับเป็นโหมดแก้ไขได้ในที่เดียวกัน */}
            {reviews.my_review && !editingReview ? (
              <View style={styles.myReview}>
                <View style={styles.reviewRowHead}>
                  <GradeRating value={reviews.my_review.rating} size={20} />
                  <Text style={styles.myReviewTag}>รีวิวของคุณ</Text>
                </View>
                {reviews.my_review.comment ? (
                  <Text style={styles.reviewComment}>{reviews.my_review.comment}</Text>
                ) : null}
                {reviews.my_review.photo_url ? (
                  <Pressable
                    onPress={() => {
                      const uri = resolveAssetUrl(reviews.my_review!.photo_url);
                      if (uri) setViewing({ uri, caption: 'รีวิวของคุณ' });
                    }}
                  >
                    <Image
                      source={{ uri: resolveAssetUrl(reviews.my_review.photo_url) ?? undefined }}
                      style={styles.reviewPhoto}
                    />
                  </Pressable>
                ) : null}
                <View style={styles.myReviewActions}>
                  <Pressable
                    onPress={onStartEditReview}
                    style={styles.reviewActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="แก้ไขรีวิว"
                  >
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                    <Text style={styles.reviewLink}>แก้ไข</Text>
                  </Pressable>
                  <Pressable
                    onPress={onDeleteReview}
                    disabled={deletingReview}
                    style={[styles.reviewActionBtn, deletingReview && styles.reviewActionBusy]}
                    accessibilityRole="button"
                    accessibilityLabel="ลบรีวิว"
                    accessibilityState={{ disabled: deletingReview, busy: deletingReview }}
                  >
                    {deletingReview ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    )}
                    <Text style={styles.reviewLinkDanger}>{deletingReview ? 'กำลังลบ...' : 'ลบ'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {reviews.can_review && (!reviews.my_review || editingReview) ? (
              <View style={styles.reviewForm}>
                <Text style={styles.reviewFormTitle}>
                  {editingReview ? 'แก้ไขรีวิวของคุณ' : 'ให้คะแนน Event นี้'}
                </Text>
                <GradeRating value={draftRating} size={40} onChange={setDraftRating} />
                <FormField
                  label="ความคิดเห็น (ไม่บังคับ)"
                  value={draftComment}
                  onChangeText={setDraftComment}
                  placeholder="เล่าให้คนอื่นฟังว่าเป็นยังไงบ้าง"
                  multiline
                  maxLength={500}
                />
                <Pressable onPress={onPickReviewPhoto} style={styles.addPhotoRow} accessibilityRole="button">
                  {draftPhoto ? (
                    <Image source={{ uri: draftPhoto.uri }} style={styles.reviewPhoto} />
                  ) : (
                    <View style={[styles.reviewPhoto, styles.addPhotoPlaceholder]}>
                      <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                    </View>
                  )}
                  <Text style={styles.addPhotoText}>
                    {draftPhoto ? 'เปลี่ยนรูป' : 'แนบรูป (ไม่บังคับ)'}
                  </Text>
                </Pressable>
                <PrimaryButton
                  title={editingReview ? 'บันทึกการแก้ไข' : 'ส่งรีวิว'}
                  onPress={onSaveReview}
                  loading={savingReview}
                />
                {editingReview ? (
                  <PrimaryButton title="ยกเลิกการแก้ไข" variant="secondary" onPress={() => setEditingReview(false)} />
                ) : null}
              </View>
            ) : null}

            {/* คนที่ยังไม่ได้ใช้สิทธิ์ อ่านได้แต่เขียนไม่ได้ — บอกเหตุผลไปเลยจะได้ไม่งง (guest ด้วย) */}
            {!reviews.can_review && !reviews.my_review ? (
              <View style={styles.reviewHintRow}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
                <Text style={styles.reviewHintInline}>
                  {isLoggedIn
                    ? 'รีวิวได้หลังจากใช้สิทธิ์ของ Event นี้แล้ว'
                    : 'เข้าสู่ระบบและใช้สิทธิ์ของ Event นี้แล้วจึงจะรีวิวได้'}
                </Text>
              </View>
            ) : null}

            {reviews.reviews.map((r) => (
              <View key={r.id} style={styles.reviewItem}>
                <View style={styles.reviewRowHead}>
                  <GradeRating value={r.rating} size={18} />
                  <Text style={styles.reviewAuthor}>{r.user_name}</Text>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
                {r.photo_url ? (
                  <Pressable
                    onPress={() => {
                      const uri = resolveAssetUrl(r.photo_url);
                      if (uri) setViewing({ uri, caption: r.user_name });
                    }}
                  >
                    <Image source={{ uri: resolveAssetUrl(r.photo_url) ?? undefined }} style={styles.reviewPhoto} />
                  </Pressable>
                ) : null}
              </View>
            ))}

            {reviews.summary.count === 0 ? (
              <Text style={styles.reviewHint}>ยังไม่มีรีวิว — เป็นคนแรกที่รีวิว Event นี้ได้เลย</Text>
            ) : null}
          </View>
        ) : null}

      </View>
    </ScrollView>

      {/* แถบปุ่มหลักติดด้านล่าง — เดิมปุ่มรับตั๋วอยู่ท้ายสุดของหน้า ต่อจากรีวิวทั้งหมด ต้องเลื่อนหา */}
      <View style={[styles.footer, { paddingBottom: spacing.sm + insets.bottom }]}>
        <ErrorBanner message={actionError} />
        {claimHint ? <Text style={styles.claimHint}>{claimHint}</Text> : null}
        <View style={styles.footerRow}>
          <PrimaryButton
            title="ติดต่อร้าน"
            icon="chatbubble-ellipses-outline"
            variant="secondary"
            onPress={onContactShop}
            loading={openingChat}
            style={styles.footerSecondary}
          />
          <PrimaryButton
            title={claimTitle}
            icon={!inactiveMessage && !alreadyClaimed && !soldOut ? 'ticket-outline' : undefined}
            onPress={onClaimPress}
            disabled={Boolean(inactiveMessage) || alreadyClaimed || soldOut}
            loading={registering}
            style={styles.footerPrimary}
          />
        </View>
      </View>

      <ConfirmModal
        visible={claimStep === 'confirmLoginRequired'}
        title="กรุณาเข้าสู่ระบบเพื่อรับตั๋วใบนี้"
        primaryLabel="ตกลง"
        onPrimary={onConfirmLogin}
        secondaryLabel="ยกเลิก"
        onSecondary={() => setClaimStep('idle')}
      />
      <ConfirmModal
        visible={claimStep === 'confirmClaim'}
        title="ต้องการรับตั๋วใบนี้หรือไม่"
        subtitle="รับได้ 1 ใบต่อ 1 บัญชี"
        primaryLabel="รับตั๋ว"
        onPrimary={onConfirmClaim}
        secondaryLabel="ยกเลิก"
        onSecondary={() => setClaimStep('idle')}
      />
      <ConfirmModal
        visible={claimStep === 'successChoice'}
        icon="checkmark"
        title="รับตั๋วเรียบร้อยแล้ว"
        subtitle="ดูตั๋วและ QR สำหรับใช้สิทธิ์ได้ที่ ตั๋วของฉัน"
        primaryLabel="ไปที่ตั๋วของฉัน"
        onPrimary={() => {
          setClaimStep('idle');
          navigation.navigate('Wallet');
        }}
        secondaryLabel="อยู่หน้านี้ต่อ"
        onSecondary={() => setClaimStep('idle')}
      />

      <ImageViewerModal
        uri={viewing?.uri ?? null}
        caption={viewing?.caption}
        onClose={() => setViewing(null)}
      />
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: spacing.lg },
  errorOnly: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center', gap: spacing.md },
  heroImage: { height: 240, backgroundColor: colors.surfaceHigh },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  placeholderText: { ...type.bodySmall, color: colors.textMuted },
  soldOutBadge: {
    position: 'absolute', top: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4,
  },
  soldOutBadgeText: { ...type.label, color: '#fff' },
  imageCount: {
    position: 'absolute', bottom: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2,
  },
  imageCountText: { ...type.caption, color: '#fff' },
  body: { padding: spacing.md, gap: spacing.md },
  title: { ...type.title, color: colors.text },
  inactiveNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md,
  },
  inactiveNoticeText: { ...type.bodyStrong, color: colors.warning, flex: 1 },

  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 8,
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerSecondary: { flex: 1 },
  footerPrimary: { flex: 1.6 },
  claimHint: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 21,
    gap: spacing.sm,
    ...shadows.card,
  },
  row: { gap: 0 },
  rowLabel: { ...type.caption, color: colors.textMuted },
  rowValue: { ...type.bodyStrong, color: colors.text },
  sectionTitle: { ...type.subheading, color: colors.text },
  description: { ...type.body, color: colors.text },

  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewScore: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reviewCount: { ...type.caption, color: colors.textMuted },
  shopAverageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  shopAverage: { ...type.caption, color: colors.textMuted },
  myReview: {
    marginTop: spacing.sm,
    padding: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    gap: 4,
  },
  myReviewTag: { ...type.captionStrong, color: colors.primaryDark },
  myReviewActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  reviewActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    minHeight: touch.min, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface,
  },
  reviewActionBusy: { opacity: 0.7 },
  reviewForm: { marginTop: spacing.sm, gap: spacing.sm },
  reviewFormTitle: { ...type.bodyStrong, color: colors.text },
  reviewLink: { ...type.label, color: colors.primary },
  reviewLinkDanger: { ...type.label, color: colors.danger },
  reviewHint: { ...type.bodySmall, color: colors.textMuted, marginTop: spacing.sm },
  reviewHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
    backgroundColor: colors.surfaceLow, borderRadius: radius.md, padding: 12,
  },
  reviewHintInline: { ...type.bodySmall, color: colors.textMuted, flex: 1 },
  reviewItem: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 4 },
  reviewRowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reviewAuthor: { ...type.caption, color: colors.textMuted },
  reviewComment: { ...type.bodySmall, color: colors.text },
  reviewPhoto: { width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.border, marginTop: 4 },
  addPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touch.min },
  addPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'dashed' },
  addPhotoText: { ...type.label, color: colors.primary },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: touch.min,
  },
  productThumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.background },
  productThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  productInfo: { flex: 1, gap: 0 },
  productName: { ...type.bodySmall, color: colors.text },
  tapHint: { ...type.caption, color: colors.textMuted },
  productPrices: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  priceBefore: { ...type.bodySmall, color: colors.textMuted, textDecorationLine: 'line-through' },
  priceAfter: { ...type.bodyStrong, color: colors.primary },
});
