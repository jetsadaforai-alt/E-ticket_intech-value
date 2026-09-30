import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ScrollView, Image } from 'react-native';
import { Text } from '../components/AppText';
import * as ImagePicker from 'expo-image-picker';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import { getQuota, type Quota } from '../api/quota';
import { resolveAssetUrl } from '../utils/assetUrl';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { LoadingView } from '../components/LoadingView';
import { ErrorBanner } from '../components/ErrorBanner';
import { formatDateTimeLabel } from '../utils/datetime';
import { buildImageFormData, toJpegAsset, type UploadableImage } from '../utils/imageUpload';
import { useRequireMode } from '../hooks/useRequireMode';
import { useRedemptionWindow, type RedemptionSlot } from '../hooks/useRedemptionWindow';
import { RedemptionWindowSection } from '../components/RedemptionWindowSection';
import { useEventProducts } from '../hooks/useEventProducts';
import { ProductPickerSection } from '../components/ProductPickerSection';
import { EventCard, type EventListItem } from '../components/EventCard';
import { formatDiscountBadge } from '../api/products';
import type { Product } from '../api/products';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EventForm'>;

type EventDetail = {
  id: string;
  shopId: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  startTime: string;
  endTime: string;
  images: { id: string; imageUrl: string }[];
  ticketCap: number;
  ticketBatch: {
    totalQty: number;
    remainingCount: number;
    discountValueBaht: string;
    fallbackDiscountValueBaht: string | null;
  } | null;
  redemptionWindow: { validFrom: string | null; validUntil: string | null; slots: RedemptionSlot[] } | null;
  products: (Product & { discount_value_baht: number })[];
  discount_min_baht: number;
  discount_max_baht: number;
};

/**
 * Live discount range while the vendor is still typing, before any round-trip to the
 * server — same shape as the backend's discountRange (min===max unless products actually
 * differ), computed from whatever is in the form right now. Blank/invalid entries read as
 * 0 rather than being excluded, matching how an incomplete field would actually submit.
 */
function liveDiscountRange(
  selectedIds: string[],
  discounts: Record<string, string>,
  wholeShopDiscount: string
): { min: number; max: number } {
  if (selectedIds.length === 0) {
    const value = Number(wholeShopDiscount) || 0;
    return { min: value, max: value };
  }
  const values = selectedIds.map((id) => Number(discounts[id]) || 0);
  return { min: Math.min(...values), max: Math.max(...values) };
}

type PickerTarget = 'start' | 'end' | null;

const MAX_IMAGES = 5; // matches MAX_IMAGES_PER_EVENT in backend/src/routes/events.js

// Matches backend/src/routes/shops.js's EVENT_CATEGORIES and HomeScreen's category chips.
const EVENT_CATEGORIES = [
  { value: 'food_drink', label: 'อาหารและเครื่องดื่ม' },
  { value: 'music', label: 'ดนตรี' },
  { value: 'workshops', label: 'เวิร์กช็อป' },
];

// Without these the vendor sees the raw backend code, which tells them nothing about
// which field to fix. Only reachable in edit mode — create's failure modes are covered
// by the plain err.message fallback instead.
const SAVE_ERROR_TH: Record<string, string> = {
  VALID_UNTIL_AFTER_EVENT_END: 'วันสิ้นสุดของเงื่อนไขต้องไม่เกินวันสิ้นสุดของ Event',
  VALID_UNTIL_BEFORE_VALID_FROM: 'วันสิ้นสุดของเงื่อนไขต้องอยู่หลังวันเริ่ม',
  INVALID_DAY_OF_WEEK: 'วันในเงื่อนไขไม่ถูกต้อง',
  INVALID_SLOT_TIME_RANGE: 'ช่วงเวลาไม่ถูกต้อง — ใช้รูปแบบ HH:mm และเวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม',
  INVALID_REDEMPTION_WINDOW: 'เงื่อนไขการใช้สิทธิ์ไม่ถูกต้อง',
  DESCRIPTION_TOO_LONG: 'รายละเอียดยาวเกิน 2000 ตัวอักษร',
  INVALID_TIME_RANGE: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม',
  PRODUCT_ARCHIVED: 'มีสินค้าที่ถูกซ่อนอยู่ในรายการที่เลือก',
  PRODUCT_NOT_FOUND: 'ไม่พบสินค้าที่เลือกไว้',
  // Reachable when the event stopped being active while this screen was open — it
  // expired, the shop cancelled it elsewhere, or an admin banned it. Retrying will
  // never work, so the message has to say so instead of falling back to 'ลองใหม่อีกครั้ง'.
  NOT_ACTIVE: 'Event นี้ไม่ได้เปิดอยู่แล้ว จึงแก้ไขไม่ได้ — ลองกลับไปเปิดหน้านี้ใหม่',
  NOT_FOUND: 'ไม่พบ Event นี้แล้ว',
  FORBIDDEN: 'คุณไม่มีสิทธิ์แก้ไข Event นี้',
};

/**
 * Create and edit are the same form (same card: details, dates, products, redemption
 * conditions) — this is one screen, branching on whether `eventId` is set, rather than
 * two screens with the same layout duplicated between them. The two modes still differ
 * in a few real ways that can't be unified: ticket quantity/discount are only set once
 * at creation (editing them afterward would desync the already-issued ticket batch), the
 * status badge/ticket-stats card/cancel button only make sense once the event exists, and
 * images are handled differently (batched locally then uploaded after creation for a new
 * event, vs. uploaded/deleted immediately against the existing event when editing).
 */
export default function EventFormScreen({ route, navigation }: Props) {
  const { shopId, eventId, cloneFromEventId } = route.params;
  const isEdit = Boolean(eventId);
  // Clone mode stays in "create" shape (new start/end/qty required, 4-step wizard)
  // but pre-fills everything else from the source event — see loadSourceEvent below.
  const isClone = Boolean(cloneFromEventId);
  useRequireMode(['vendor'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), shopId);

  const [event, setEvent] = useState<EventDetail | null>(null);
  // Clone-mode only — the ended event being relaunched, fetched read-only just to
  // pre-fill the create-shaped form below (never mutated, unlike `event` in edit mode).
  const [sourceEvent, setSourceEvent] = useState<EventDetail | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Create-only — not editable after creation, same as totalQty/discount below.
  const [category, setCategory] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // เปิดใช้แค่โหมดสร้าง — ข้อมูลทั้งหมดเป็น local state ล้วนจนกว่าจะกด "สร้าง Event" สเต็ปสุดท้าย
  // ออกกลางทาง (กด back/สลับแอป) ก่อนถึงตอนนั้นข้อมูลหายหมดโดยไม่มีคำเตือน — ตั้งเป็น true ทันทีที่
  // สร้าง event สำเร็จ (ดูจุดตั้งค่าด้านล่าง) กัน dialog นี้โผล่ตอน navigate ออกหลัง submit สำเร็จเอง
  const submittedRef = useRef(false);
  // แค่สลับว่า section ไหนโชว์อยู่บนจอ — ไม่ใช่ navigation จริง state/logic อื่นทั้งหมดเหมือนเดิม
  // ทุกอย่าง (ตาม Figma "สร้างกิจกรรม" ที่แบ่งขั้นตอน) — จำนวนสเต็ปต่างกันตามโหมด เพราะฟิลด์ต่างกัน
  // จริง (แก้ไขไม่มีจำนวนตั๋ว/ส่วนลดให้แก้ แต่มีการ์ดข้อมูลตั๋ว/ปุ่มยกเลิกที่สร้างใหม่ไม่มี)
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = isEdit ? 3 : 4;
  const STEP_LABEL: Record<number, string> = isEdit
    ? { 1: 'ข้อมูล Event', 2: 'รูปภาพและสินค้า', 3: 'ตรวจสอบและบันทึก' }
    : { 1: 'ข้อมูล Event', 2: 'สินค้าและส่วนลด', 3: 'จำนวนตั๋ว', 4: 'ตรวจสอบและเผยแพร่' };

  // Create-only.
  const [totalQty, setTotalQty] = useState('');
  // บาทตายตัวเท่านั้น — เคยลองมีโหมด % (auto-fill ราคาจากสินค้าที่เลือก) แต่ถอดออกแล้ว: %
  // ที่ถูกต้องตามหลักธุรกิจต้องคำนวณแยกราคาต่อสินค้า ขณะที่ระบบนี้มีส่วนลดแค่ค่าเดียวทั้ง event
  // (ไม่มี "ราคา ณ ตอน redeem" ให้อ้างอิง) UI ที่โชว์ชื่อ+ราคาสินค้าเจาะจงเลยทำให้เข้าใจผิดว่าลดแยก
  // ตามสินค้าได้จริง ทั้งที่จริงๆ เป็นเลขเดียวใช้กับทุกสินค้าที่เลือกเท่ากันหมด — ตัดสินใจเก็บไว้แค่
  // บาทตรงๆ ไปก่อน ส่วนดีไซน์ % ที่ถูกต้องจริง (แยกตามสินค้า ให้ staff เลือกตอนแลกตั๋ว) เป็นงานใหญ่
  // แยกต่างหากที่ตัดสินใจเลื่อนไว้ก่อน (ดูใน git history ถ้าจะกลับมาทำต่อ)
  const [discount, setDiscount] = useState('');
  const [images, setImages] = useState<UploadableImage[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);

  // Edit-only.
  const [uploadingImages, setUploadingImages] = useState(false);

  const redemptionWindow = useRedemptionWindow();
  const { hydrate: hydrateWindow } = redemptionWindow;
  const eventProducts = useEventProducts(shopId);
  const { hydrate: hydrateProducts } = eventProducts;

  // Quota only gates create — quantity/discount can't be changed after creation, so
  // there is nothing here for edit mode to check it against.
  useEffect(() => {
    if (isEdit) return;
    getQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, [isEdit]);

  // Only used for the live preview card below — best-effort, not required for the form
  // to work at all, so a failure here just leaves the shop name blank in the preview.
  const [shopName, setShopName] = useState('');
  useEffect(() => {
    apiRequest<{ name: string }>(`/v1/shops/${shopId}`)
      .then((shop) => setShopName(shop.name))
      .catch(() => {});
  }, [shopId]);

  // เตือนก่อนออกจากฟอร์มถ้ากรอกอะไรไปแล้ว — เฉพาะโหมดสร้างเท่านั้น (โหมดแก้ไขมีปุ่ม "บันทึก" แยก
  // ต่างหากอยู่แล้ว ผู้ใช้คาดหวังว่าออกโดยไม่กดบันทึก = ไม่เซฟ ไม่ใช่เรื่องน่าแปลกใจเหมือนโหมดสร้าง
  // ที่เป็น wizard 4 สเต็ปกว่าจะถึงปุ่มสร้างจริง) title.trim() หรือ step > 1 ถือว่ามีอะไรจะเสียแล้ว
  const hasUnsavedData = !isEdit && (title.trim() !== '' || step > 1);
  useEffect(() => {
    if (isEdit) return;
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (submittedRef.current || !hasUnsavedData) return;
      e.preventDefault();
      Alert.alert('ข้อมูลที่กรอกจะหายไป', 'ยืนยันออกจากหน้านี้หรือไม่?', [
        { text: 'อยู่ต่อ', style: 'cancel' },
        { text: 'ออกจากหน้านี้', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsubscribe;
  }, [navigation, isEdit, hasUnsavedData]);

  const load = useCallback(async () => {
    if (!eventId) return;
    const data = await apiRequest<EventDetail>(`/v1/events/${eventId}`, { auth: false });
    setEvent(data);
    setTitle(data.title);
    setDescription(data.description ?? '');
    setStartDate(new Date(data.startTime));
    setEndDate(new Date(data.endTime));
    hydrateWindow({
      validFrom: data.redemptionWindow?.validFrom ? new Date(data.redemptionWindow.validFrom) : null,
      validUntil: data.redemptionWindow?.validUntil ? new Date(data.redemptionWindow.validUntil) : null,
      slots: data.redemptionWindow?.slots ?? [],
    });
    hydrateProducts(
      data.products ?? [],
      Object.fromEntries((data.products ?? []).map((p) => [p.id, String(p.discount_value_baht)])),
      data.ticketBatch?.fallbackDiscountValueBaht ?? undefined
    );
  }, [eventId, hydrateWindow, hydrateProducts]);

  useEffect(() => {
    if (isEdit) load();
  }, [isEdit, load]);

  // Prefills the form from the ended event being relaunched. start_time/end_time are
  // deliberately NOT copied (the source event's dates already passed) — the vendor must
  // pick new ones, same as a fresh create.
  useEffect(() => {
    if (!cloneFromEventId) return;
    apiRequest<EventDetail>(`/v1/events/${cloneFromEventId}`, { auth: false })
      .then((data) => {
        setSourceEvent(data);
        setTitle(data.title);
        setDescription(data.description ?? '');
        setCategory(data.category);
        hydrateWindow({
          validFrom: data.redemptionWindow?.validFrom ? new Date(data.redemptionWindow.validFrom) : null,
          validUntil: data.redemptionWindow?.validUntil ? new Date(data.redemptionWindow.validUntil) : null,
          slots: data.redemptionWindow?.slots ?? [],
        });
        hydrateProducts(
          data.products ?? [],
          Object.fromEntries((data.products ?? []).map((p) => [p.id, String(p.discount_value_baht)])),
          data.ticketBatch?.fallbackDiscountValueBaht ?? undefined
        );
        if (data.ticketBatch) setDiscount(data.ticketBatch.discountValueBaht);
      })
      .catch(() => setFormError('โหลดข้อมูล Event ต้นทางไม่สำเร็จ'));
  }, [cloneFromEventId, hydrateWindow, hydrateProducts]);

  // Default จำนวนตั๋วรอทั้งข้อมูล Event ต้นทางและโควตาปัจจุบันพร้อมก่อน ถึงจะคำนวณเพดานที่ใช้ได้จริง
  // ได้ — กันไม่ให้ค่าเริ่มต้นสูงเกินที่สร้างได้จริง (ร้านยังแก้เป็นค่าอื่นเองได้เสมอในสเต็ป 3)
  useEffect(() => {
    if (!sourceEvent || !quota) return;
    const original = sourceEvent.ticketBatch?.totalQty ?? 0;
    const cap = Math.min(original, quota.ticket_balance, quota.ticket_per_event);
    if (cap > 0) setTotalQty(String(cap));
  }, [sourceEvent, quota]);

  const [isPickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  const showPicker = (target: PickerTarget) => {
    setPickerTarget(target);
    setPickerVisible(true);
  };
  const hidePicker = () => {
    setPickerVisible(false);
    setPickerTarget(null);
  };
  const onConfirmDate = (date: Date) => {
    if (pickerTarget === 'start') setStartDate(date);
    else if (pickerTarget === 'end') setEndDate(date);
    hidePicker();
  };

  // Create mode: picked images stay local (UploadableImage[]) and upload in a batch
  // right after the event is created.
  const pickImagesForCreate = async () => {
    setImageError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setImageError('ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGES - images.length,
        quality: 0.7,
      });
      if (result.canceled) return;

      const picked = await Promise.all(result.assets.map(toJpegAsset));
      setImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'เลือกรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  };

  // Edit mode: the event already exists, so a picked image uploads immediately.
  const addImagesToEvent = async () => {
    if (!event) return;
    setImageError(null);
    const remaining = MAX_IMAGES - event.images.length;
    if (remaining <= 0) {
      setImageError(`แนบรูปได้สูงสุด ${MAX_IMAGES} รูปต่อ Event`);
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setImageError('ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.7,
      });
      if (result.canceled) return;

      setUploadingImages(true);
      const picked = await Promise.all(result.assets.map(toJpegAsset));
      await apiRequest(`/v1/events/${event.id}/images`, { method: 'POST', formData: buildImageFormData(picked) });
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'เพิ่มรูปไม่สำเร็จ ลองใหม่อีกครั้ง';
      setImageError(message);
    } finally {
      setUploadingImages(false);
    }
  };

  const onDeleteImage = async (imageId: string) => {
    setImageError(null);
    try {
      await apiRequest(`/v1/events/${eventId}/images/${imageId}`, { method: 'DELETE' });
      await load();
    } catch {
      setImageError('ลบรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  };

  // Confirm dialog ยังเป็น Alert ตั้งใจ — destructive confirm ไม่ใช่ error display
  const onCancelEvent = () => {
    Alert.alert('ยกเลิก Event', 'ตั๋วที่ยังไม่ถูกใช้จะถูกยกเลิก ตั๋วที่ redeem ไปแล้วไม่กระทบ ยืนยันหรือไม่?', [
      { text: 'ไม่', style: 'cancel' },
      {
        text: 'ยืนยันยกเลิก',
        style: 'destructive',
        onPress: async () => {
          setCancelError(null);
          try {
            await apiRequest(`/v1/events/${eventId}/cancel`, { method: 'POST' });
            await load();
          } catch {
            setCancelError('ยกเลิก Event ไม่สำเร็จ ลองใหม่อีกครั้ง');
          }
        },
      },
    ]);
  };

  // Clearing is a local edit like any other — the change lands when the vendor presses
  // the one save button, so there is nothing to confirm and nothing to undo here.
  const onClearWindow = () => {
    redemptionWindow.clear();
    redemptionWindow.setError(null);
  };

  // ตรวจแค่ field ของสเต็ปที่กำลังจะออกจาก ให้ error โผล่ตรงจุดที่ field นั้นอยู่จริง (ไม่ใช่ไป
  // โผล่ตอนกด "สร้าง Event" ที่สเต็ป 4 ซึ่งจะมองไม่เห็น field ที่ผิดแล้ว) — onSubmit ท้ายสุดยังเช็ค
  // ซ้ำทั้งหมดอยู่ดีเป็น safety net เผื่อข้าม step มาจากทางอื่น
  const goNext = () => {
    setFormError(null);
    if (step === 1) {
      if (!title.trim()) return setFormError('กรุณากรอกชื่อ Event');
      if (!isEdit && !category) return setFormError('กรุณาเลือกประเภท Event');
      if (!startDate || !endDate) return setFormError('กรุณาเลือกเวลาเริ่มและเวลาสิ้นสุด');
      if (endDate <= startDate) return setFormError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    } else if (!isEdit && step === 2) {
      // ส่วนลดย้ายมาอยู่สเต็ปนี้แล้ว (ติดกับรายการสินค้า) — validate ตรงนี้แทนสเต็ป 3 เดิม
      if (eventProducts.isEmpty) {
        if (!Number.isFinite(Number(discount)) || Number(discount) < 0) {
          return setFormError('มูลค่าส่วนลดไม่ถูกต้อง');
        }
      } else {
        for (const id of eventProducts.selectedIds) {
          const v = Number(eventProducts.discounts[id]);
          if (!Number.isFinite(v) || v < 0) return setFormError('กรุณากรอกส่วนลดของสินค้าที่เลือกให้ครบและถูกต้อง');
        }
        if (!Number.isFinite(Number(eventProducts.fallbackDiscount)) || Number(eventProducts.fallbackDiscount) < 0) {
          return setFormError('กรุณากรอกส่วนลดสำรองให้ถูกต้อง');
        }
      }
    } else if (!isEdit && step === 3) {
      const qty = Number(totalQty);
      if (!Number.isInteger(qty) || qty <= 0) return setFormError('จำนวนตั๋วไม่ถูกต้อง');
    }
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

  const goBack = () => {
    setFormError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!title.trim()) return setFormError('กรุณากรอกชื่อ Event');
    if (!isEdit && !category) return setFormError('กรุณาเลือกประเภท Event');
    if (!startDate || !endDate) return setFormError('กรุณาเลือกเวลาเริ่มและเวลาสิ้นสุด');
    if (endDate <= startDate) return setFormError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');

    // Validate the redemption window BEFORE writing anything. On create, the backend
    // rejects valid_until past the event's end with a 400, and discovering that on the
    // follow-up request would leave an event that exists but couldn't be configured.
    // redemptionWindow.setError() already surfaces this inline inside
    // RedemptionWindowSection — no need for a second, duplicate banner here.
    const windowProblem = redemptionWindow.validate(endDate);
    if (windowProblem) {
      redemptionWindow.setError(windowProblem);
      return;
    }

    if (isEdit) {
      setBusy(true);
      redemptionWindow.setError(null);
      eventProducts.setError(null);
      try {
        await apiRequest(`/v1/events/${eventId}`, {
          method: 'PATCH',
          body: {
            title: title.trim(),
            description,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            product_ids: eventProducts.selectedIds,
            redemption_window: redemptionWindow.toPayload(),
          },
        });
        await load();
        // ยังเป็น Alert ตั้งใจ — success ไม่ใช่ error display
        Alert.alert('บันทึกแล้ว', '');
      } catch (err) {
        const code = err instanceof ApiError ? err.message : '';
        setFormError(SAVE_ERROR_TH[code] ?? 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
      } finally {
        setBusy(false);
      }
      return;
    }

    const qty = Number(totalQty);
    if (!Number.isInteger(qty) || qty <= 0) return setFormError('จำนวนตั๋วไม่ถูกต้อง');

    let discountValue = 0;
    let productDiscounts: Record<string, number> | undefined;
    let fallbackDiscountValue: number | undefined;
    if (eventProducts.isEmpty) {
      if (!Number.isFinite(Number(discount)) || Number(discount) < 0) {
        return setFormError('มูลค่าส่วนลดไม่ถูกต้อง');
      }
      discountValue = Number(discount) || 0;
    } else {
      productDiscounts = {};
      for (const id of eventProducts.selectedIds) {
        const v = Number(eventProducts.discounts[id]);
        if (!Number.isFinite(v) || v < 0) return setFormError('กรุณากรอกส่วนลดของสินค้าที่เลือกให้ครบและถูกต้อง');
        productDiscounts[id] = v;
      }
      const fb = Number(eventProducts.fallbackDiscount);
      if (!Number.isFinite(fb) || fb < 0) return setFormError('กรุณากรอกส่วนลดสำรองให้ถูกต้อง');
      fallbackDiscountValue = fb;
    }

    if (quota) {
      if (quota.event_balance < 1) {
        return Alert.alert('โควตา Event หมดแล้ว', 'ซื้อโควตาเพิ่มหรืออัปเกรดแพ็กเกจก่อนจึงจะสร้าง Event ใหม่ได้', [
          { text: 'ยกเลิก', style: 'cancel' },
          { text: 'ซื้อโควตา', onPress: () => navigation.navigate('Topup') },
        ]);
      }
      if (qty > quota.ticket_per_event) {
        return Alert.alert(
          'เกินเพดานตั๋วต่อ Event',
          `แพ็กเกจ ${quota.package.name} จำกัด ${quota.ticket_per_event} ใบต่อ 1 Event — ลดจำนวนลง หรืออัปเกรดแพ็กเกจ`,
          [
            { text: 'ตกลง', style: 'cancel' },
            { text: 'ดูแพ็กเกจ', onPress: () => navigation.navigate('Packages') },
          ]
        );
      }
      if (qty > quota.ticket_balance) {
        return Alert.alert('ตั๋วคงเหลือไม่พอ', `เหลือ ${quota.ticket_balance} ใบ แต่ต้องใช้ ${qty} ใบ`, [
          { text: 'ยกเลิก', style: 'cancel' },
          { text: 'ซื้อตั๋วเพิ่ม', onPress: () => navigation.navigate('Topup') },
        ]);
      }
    }

    setBusy(true);
    let created: { id: string };
    try {
      // Relaunch reuses this exact body shape server-side (see POST /v1/events/:id/relaunch)
      // — only the URL and the fact that images are inherited automatically differ.
      created = await apiRequest<{ id: string }>(
        cloneFromEventId ? `/v1/events/${cloneFromEventId}/relaunch` : `/v1/shops/${shopId}/events`,
        {
          method: 'POST',
          body: {
            title: title.trim(),
            description: description.trim() || undefined,
            category,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            total_qty: qty,
            discount_value_baht: discountValue,
            // Both ride along in this one request so the event and everything that
            // configures it are written in a single transaction. They used to be follow-up
            // calls, which meant a failure part-way left a live event the vendor had to go
            // and finish configuring by hand.
            product_ids: eventProducts.selectedIds,
            product_discounts: productDiscounts,
            fallback_discount_value_baht: fallbackDiscountValue,
            redemption_window: redemptionWindow.isEmpty ? undefined : redemptionWindow.toPayload(),
          },
        }
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (isClone ? 'เปิด Event ใหม่ไม่สำเร็จ' : 'สร้าง Event ไม่สำเร็จ');
      setFormError(message);
      setBusy(false);
      return;
    }

    // Event already exists at this point — nothing left to lose, so the leave-confirm
    // guard below should stop blocking navigation from here on (both success paths below
    // navigate away).
    submittedRef.current = true;

    // Event already exists at this point — a failure past here must not be reported
    // as "create failed", since retrying would create a duplicate event. Still an Alert
    // on purpose: this is a distinct partial-success outcome, not a plain error, and it
    // carries a navigation action — collapsing it into the same red ErrorBanner as a
    // real failure would lose that distinction.
    if (images.length > 0) {
      try {
        await apiRequest(`/v1/events/${created.id}/images`, { method: 'POST', formData: buildImageFormData(images) });
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'อัปโหลดรูปไม่สำเร็จ';
        setBusy(false);
        Alert.alert('สร้าง Event สำเร็จ แต่แนบรูปไม่สำเร็จ', `${message} — สามารถแนบรูปใหม่ได้ภายหลังจากหน้าจัดการ Event`, [
          { text: 'ตกลง', onPress: () => navigation.navigate('ShopEvents', { shopId }) },
        ]);
        return;
      }
    }

    setBusy(false);
    // ยังเป็น Alert ตั้งใจ — success + พาไปหน้าถัดไป ไม่ใช่แค่ error display
    Alert.alert('สำเร็จ', isClone ? 'เปิด Event ใหม่เรียบร้อยแล้ว' : 'สร้าง Event เรียบร้อยแล้ว', [
      { text: 'ตกลง', onPress: () => navigation.navigate('ShopEvents', { shopId }) },
    ]);
  };

  if (isEdit && !event) {
    return <LoadingView label="กำลังโหลด Event..." />;
  }

  // โควตารู้ผลตั้งแต่เปิดหน้ามา (getQuota ด้านบน) — เช็คก่อน render ฟอร์มเลย กันเสียเวลากรอกฟอร์ม
  // ทั้งหมดแล้วมาเจอ block ตอนกด "สร้าง Event" ทีหลัง (onSubmit ยังมี check ซ้ำไว้เป็น safety net
  // เผื่อโควตาเปลี่ยนไปหลังโหลดหน้าแล้ว)
  if (!isEdit && quota && quota.event_balance < 1) {
    return (
      <View style={styles.quotaEmptyWrap}>
        <ErrorBanner message="โควตา Event หมดแล้ว ซื้อโควตาเพิ่มหรืออัปเกรดแพ็กเกจก่อนจึงจะสร้าง Event ใหม่ได้" />
        <PrimaryButton title="ซื้อโควตาเพิ่ม" onPress={() => navigation.navigate('Topup')} />
        <PrimaryButton title="กลับ" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  // การ์ดตัวอย่างที่ลูกค้าจะเห็นจริง — ใช้ component เดียวกันเป๊ะกับที่ HomeScreen แสดง
  // (EventCard) ไม่ใช่แค่โค้ดหน้าตาคล้ายกัน กันไม่ให้ preview เพี้ยนจากของจริงถ้าแก้ทีหลัง
  const previewImage = isEdit && event
    ? event.images[0]?.imageUrl ?? null
    : images[0]?.uri ?? (isClone ? sourceEvent?.images[0]?.imageUrl ?? null : null);
  const previewRemaining = isEdit && event ? event.ticketBatch?.remainingCount ?? 0 : Number(totalQty) || 0;
  const previewRange =
    isEdit && event
      ? { min: event.discount_min_baht, max: event.discount_max_baht }
      : liveDiscountRange(eventProducts.selectedIds, eventProducts.discounts, discount);
  const previewItem: EventListItem = {
    id: 'preview',
    title: title.trim() || 'ชื่อ Event',
    category: (isEdit ? event?.category : category) ?? 'food_drink',
    shop_name: shopName || 'ร้านของคุณ',
    shop_logo_url: null,
    thumbnail_url: previewImage,
    discount_min_baht: previewRange.min,
    discount_max_baht: previewRange.max,
    remaining_count: previewRemaining,
    sold_out: false,
    claimed_count: 0,
    end_time: (endDate ?? new Date()).toISOString(),
    rating_average: null,
    rating_count: 0,
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <ErrorBanner message={formError} />

        <View style={styles.stepHeader}>
          <View style={styles.stepSegmentRow}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.stepSegment,
                  i < step - 1 && styles.stepSegmentDone,
                  i === step - 1 && styles.stepSegmentCurrent,
                ]}
              />
            ))}
          </View>
          <Text style={styles.stepLabel}>
            ขั้นตอนที่ {step} จาก {TOTAL_STEPS}: {STEP_LABEL[step]}
          </Text>
        </View>

        {step === 1 && (
          <>
            {isEdit && event && <Text style={styles.statusBadge}>สถานะ: {event.status}</Text>}
            {isClone && (
              <Text style={styles.cloneHint}>
                {sourceEvent
                  ? `เปิดใหม่จาก "${sourceEvent.title}" — ข้อมูลถูกกรอกไว้ให้แล้ว ปรับแก้ได้ก่อนสร้าง (ต้องเลือกเวลาเริ่ม/สิ้นสุดใหม่)`
                  : 'กำลังโหลดข้อมูล Event ต้นทาง...'}
              </Text>
            )}
            <FormField label="ชื่อ Event" value={title} onChangeText={setTitle} placeholder="เช่น โปรลด 20% วันธรรมดา" />

            <FormField
              label="รายละเอียด (ไม่บังคับ, สูงสุด 2000 ตัวอักษร)"
              value={description}
              onChangeText={setDescription}
              style={{ height: 90 }}
              multiline
              maxLength={2000}
            />

            {!isEdit && (
              <View style={styles.categorySection}>
                <Text style={styles.categoryLabel}>ประเภท Event</Text>
                <Text style={styles.lockedFieldHint}>เลือกแล้วแก้ไขภายหลังไม่ได้</Text>
                <View style={styles.categoryRow}>
                  {EVENT_CATEGORIES.map((c) => {
                    const active = c.value === category;
                    return (
                      <TouchableOpacity
                        key={c.value}
                        onPress={() => setCategory(c.value)}
                        style={[styles.categoryChip, active && styles.categoryChipActive]}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                          {c.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <TouchableOpacity onPress={() => showPicker('start')}>
              <View pointerEvents="none">
                <FormField
                  label="เวลาเริ่ม"
                  value={formatDateTimeLabel(startDate)}
                  placeholder="แตะเพื่อเลือกวันเวลา"
                  helperText="แตะเพื่อเปิดปฏิทิน"
                  editable={false}
                />
              </View>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => showPicker('end')}>
              <View pointerEvents="none">
                <FormField
                  label="เวลาสิ้นสุด"
                  value={formatDateTimeLabel(endDate)}
                  placeholder="แตะเพื่อเลือกวันเวลา"
                  helperText="แตะเพื่อเปิดปฏิทิน"
                  editable={false}
                />
              </View>
            </TouchableOpacity>
          </>
        )}

        {!isEdit && step === 3 && (
          <>
            <Text style={styles.lockedFieldHint}>จำนวนตั๋วแก้ไขภายหลังไม่ได้ — อยากได้ตั๋วเพิ่มทีหลังใช้ "ซื้อตั๋วเพิ่ม" แทน</Text>
            <FormField
              label="จำนวนตั๋ว"
              value={totalQty}
              onChangeText={setTotalQty}
              keyboardType="number-pad"
              helperText={
                quota
                  ? `เหลือ ${quota.ticket_balance} ใบ · สูงสุด ${quota.ticket_per_event} ใบต่อ Event`
                  : undefined
              }
            />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.label}>
              รูปภาพ {isEdit && event ? `(${event.images.length}/${MAX_IMAGES})` : `(สูงสุด ${MAX_IMAGES} รูป)`}
            </Text>
            <ErrorBanner message={imageError} />
            <View style={styles.imageRow}>
              {isEdit && event ? (
                <>
                  {event.images.map((img, i) => (
                    <View key={img.id}>
                      <Image source={{ uri: resolveAssetUrl(img.imageUrl) ?? undefined }} style={styles.thumb} />
                      {/* รูปแรกในลิสต์ = รูปที่การ์ด event ใช้เป็นภาพหลัก (ดู EventCard) — ใส่ badge
                          ให้เห็นชัดว่ารูปไหนคือรูปที่ลูกค้าจะเห็นก่อน */}
                      {i === 0 && (
                        <View style={styles.coverBadge}>
                          <Text style={styles.coverBadgeText}>รูปปก</Text>
                        </View>
                      )}
                      <TouchableOpacity style={styles.deleteBadge} onPress={() => onDeleteImage(img.id)}>
                        <Text style={styles.deleteBadgeText}>ลบ</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {event.images.length < MAX_IMAGES && (
                    <TouchableOpacity style={styles.addImageButton} onPress={addImagesToEvent} disabled={uploadingImages}>
                      <Text style={styles.addImageText}>{uploadingImages ? 'กำลังอัปโหลด...' : '+ เพิ่มรูป'}</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : isClone ? (
                // Images are copied server-side when the relaunch request succeeds (no
                // re-upload needed) — shown here read-only just so the vendor can see
                // what's coming along, same as everything else on this screen.
                <>
                  {(sourceEvent?.images ?? []).map((img, i) => (
                    <View key={img.id}>
                      <Image source={{ uri: resolveAssetUrl(img.imageUrl) ?? undefined }} style={styles.thumb} />
                      {i === 0 && (
                        <View style={styles.coverBadge}>
                          <Text style={styles.coverBadgeText}>รูปปก</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  {sourceEvent && sourceEvent.images.length === 0 && (
                    <Text style={styles.lockedFieldHint}>Event เดิมไม่มีรูปภาพ</Text>
                  )}
                </>
              ) : (
                <>
                  {images.map((img, i) => (
                    <View key={i}>
                      <Image source={{ uri: img.uri }} style={styles.thumb} />
                      {i === 0 && (
                        <View style={styles.coverBadge}>
                          <Text style={styles.coverBadgeText}>รูปปก</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <TouchableOpacity style={styles.addImageButton} onPress={pickImagesForCreate}>
                      <Text style={styles.addImageText}>+ เพิ่มรูป</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>

            {/* Merged into this card rather than shown as their own — the redemption
                block's date-range fields are hidden here since "เวลาเริ่ม"/"เวลาสิ้นสุด"
                above already set the event's own start/end. */}
            <ProductPickerSection
              products={eventProducts}
              onManageProducts={() => navigation.navigate('ShopProducts', { shopId })}
            />

            {!isEdit && (
              <>
                <Text style={styles.lockedFieldHint}>ตั้งส่วนลดที่นี่ — แก้ไขภายหลังไม่ได้</Text>
                {eventProducts.isEmpty ? (
                  <FormField
                    label="ส่วนลด (บาท)"
                    value={discount}
                    onChangeText={setDiscount}
                    keyboardType="numeric"
                    placeholder="0"
                    helperText="ไม่ได้ผูกกับสินค้าเจาะจง — ใช้ลดทั้งร้าน"
                  />
                ) : (
                  <>
                    {eventProducts.available
                      .filter((p) => eventProducts.selectedIds.includes(p.id))
                      .map((p) => (
                        <FormField
                          key={p.id}
                          label={`ส่วนลด — ${p.name} (${Number(p.priceBaht).toLocaleString()} บาท)`}
                          value={eventProducts.discounts[p.id] ?? ''}
                          onChangeText={(v) => eventProducts.setProductDiscount(p.id, v)}
                          keyboardType="numeric"
                          placeholder="0"
                        />
                      ))}
                    <FormField
                      label="ส่วนลดสำรอง (กรณีสินค้าหมดหน้างาน)"
                      value={eventProducts.fallbackDiscount}
                      onChangeText={eventProducts.setFallbackDiscount}
                      keyboardType="numeric"
                      placeholder="0"
                      helperText="ใช้ตอนพนักงานกดสินค้าหมดระหว่างสแกน"
                    />
                  </>
                )}
              </>
            )}

            <RedemptionWindowSection
              window={redemptionWindow}
              hint="ถ้าอยากให้ลูกค้าแลกตั๋วได้เฉพาะบางวัน/บางช่วงเวลาเท่านั้น ตั้งค่าด้านล่างนี้ได้ — เว้นว่างทั้งหมด = ลูกค้าแลกตั๋วได้ทุกวันทุกเวลาตลอดอายุ Event (ไม่บังคับ ตั้งภายหลังได้)"
              footer={
                isEdit || isClone ? (
                  // Not a save — it only empties the fields. The change is stored by the
                  // one submit button below, along with everything else on the screen.
                  <TouchableOpacity onPress={onClearWindow} hitSlop={8}>
                    <Text style={styles.clearWindowText}>ล้างเงื่อนไขทั้งหมด</Text>
                  </TouchableOpacity>
                ) : undefined
              }
            />
          </>
        )}
      </View>

      {isEdit && event && step === 3 && (
        <View style={styles.card}>
          <ErrorBanner message={cancelError} />
          <Text style={styles.label}>ตั๋ว</Text>
          <Text style={styles.ticketInfo}>
            เหลือ {event.ticketBatch?.remainingCount}/{event.ticketBatch?.totalQty} ·{' '}
            {formatDiscountBadge(event.discount_min_baht, event.discount_max_baht)}
          </Text>
          <Text style={styles.ticketInfo}>เพดานตั๋วของ Event นี้: {event.ticketCap} ใบ</Text>
          {event.status === 'active' && (
            // Buying tickets here raises this event's own ceiling, which is the only way
            // to grow an event past the limit its package set when it was created.
            <TouchableOpacity
              style={styles.topupLink}
              onPress={() => navigation.navigate('Topup', { eventId: event.id, eventTitle: event.title })}
            >
              <Text style={styles.topupLinkText}>+ ซื้อตั๋วเพิ่มให้ Event นี้</Text>
            </TouchableOpacity>
          )}

          {event.status === 'active' && <PrimaryButton title="ยกเลิก Event" variant="danger" onPress={onCancelEvent} />}
        </View>
      )}

      {((isEdit && step === 3) || (!isEdit && step === 4)) && (
        <View style={styles.previewSection}>
          <Text style={styles.previewLabel}>ตัวอย่างที่ลูกค้าจะเห็น</Text>
          <EventCard item={previewItem} onPress={() => {}} />
        </View>
      )}

      <View style={styles.navRow}>
        {step > 1 ? (
          <PrimaryButton title="ย้อนกลับ" variant="secondary" onPress={goBack} style={styles.navBtn} />
        ) : (
          <View style={styles.navBtn} />
        )}
        {step < TOTAL_STEPS ? (
          <PrimaryButton title="ถัดไป" onPress={goNext} style={styles.navBtn} />
        ) : (
          <PrimaryButton
            title={
              busy
                ? isEdit
                  ? 'กำลังบันทึก...'
                  : isClone
                  ? 'กำลังเปิด...'
                  : 'กำลังสร้าง...'
                : isEdit
                ? 'บันทึกการแก้ไข'
                : isClone
                ? 'เปิด Event ใหม่'
                : 'สร้าง Event'
            }
            onPress={onSubmit}
            loading={busy}
            style={styles.navBtn}
          />
        )}
      </View>

      <DateTimePickerModal
        isVisible={isPickerVisible}
        mode="datetime"
        date={(pickerTarget === 'start' ? startDate : pickerTarget === 'end' ? endDate : null) ?? new Date()}
        onConfirm={onConfirmDate}
        onCancel={hidePicker}
        locale="th_TH"
        confirmTextIOS="ตกลง"
        cancelTextIOS="ยกเลิก"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, backgroundColor: colors.background, gap: spacing.md },
  cloneHint: { fontSize: 12, color: colors.primary, fontWeight: '600', marginTop: -4 },
  categorySection: { gap: spacing.xs },
  categoryLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  lockedFieldHint: { fontSize: 12, color: colors.textMuted, marginTop: -4 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { fontSize: 12, fontWeight: '600', color: colors.text },
  categoryChipTextActive: { color: '#fff' },
  quotaEmptyWrap: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  statusBadge: { fontSize: 13, color: colors.textMuted },
  stepHeader: { gap: spacing.xs },
  stepSegmentRow: { flexDirection: 'row', gap: 4 },
  stepSegment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  stepSegmentDone: { backgroundColor: colors.primary },
  stepSegmentCurrent: { backgroundColor: colors.primary, opacity: 0.6 },
  stepLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl },
  navBtn: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.border },
  deleteBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  deleteBadgeText: { color: '#fff', fontSize: 10 },
  addImageButton: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  addImageText: { fontSize: 11, color: colors.primary, textAlign: 'center' },
  topupLink: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  topupLinkText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  clearWindowText: { fontSize: 13, color: colors.danger, fontWeight: '700', paddingVertical: spacing.xs },
  ticketInfo: { fontSize: 14, color: colors.text },
  previewSection: { gap: spacing.sm },
  previewLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
});
