import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, Image, Pressable, TouchableOpacity, Switch } from 'react-native';
import { Text } from '../components/AppText';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import {
  listProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  uploadProductImage,
  type Product,
} from '../api/products';
import { resolveAssetUrl } from '../utils/assetUrl';
import { toJpegAsset, buildSingleImageFormData } from '../utils/imageUpload';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { LoadingView } from '../components/LoadingView';
import { ErrorBanner } from '../components/ErrorBanner';
import { useRequireMode } from '../hooks/useRequireMode';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ShopProducts'>;

type PendingSubstitution = {
  eventId: string;
  eventTitle: string;
  outOfStockProductId: string;
  outOfStockProductName: string;
  outOfStockDiscount: number;
};

/**
 * The shop's product list. Products exist so an event can say it discounts specific items
 * rather than the whole shop; an event that links none still means "everything".
 *
 * "Delete" archives rather than removes: events that already discount an item keep showing
 * it, so a ticket someone is holding never loses the explanation of what it was for.
 */
export default function ShopProductsScreen({ route, navigation }: Props) {
  const { shopId } = route.params;
  useRequireMode(['vendor'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }), shopId);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // แยกจาก name/price/formError ของฟอร์ม "เพิ่มสินค้า" บนสุดโดยเจตนา — แก้ไขตอนนี้เกิด
  // inline ที่ตัวแถวเอง ไม่ใช้ฟอร์มร่วมกันแล้ว (เดิมกดแก้ไขแล้วต้องเลื่อนขึ้นไปดูฟอร์มบนสุด งง)
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // archive/restore/แนบรูป เป็น action ต่อแถวในลิสต์ ใช้ banner เดียวกันบนสุด
  const [listActionError, setListActionError] = useState<string | null>(null);

  // Prompted right after archiving a product that's still linked to an active event —
  // one entry per affected event, so the vendor picks a substitute per event rather than
  // one substitute applied blindly everywhere. Best-effort: if the check that populates
  // this fails, the archive itself already succeeded, so nothing looks broken — the
  // vendor can still link a replacement later from the event's own product picker.
  const [pendingSubstitutions, setPendingSubstitutions] = useState<PendingSubstitution[]>([]);
  const [substitutingEventId, setSubstitutingEventId] = useState<string | null>(null);
  const [substituteError, setSubstituteError] = useState<string | null>(null);
  // Confirm-before-send step for one chip tap — prefilled from the out-of-stock
  // product's own rate, editable before the request actually goes out.
  const [confirmTarget, setConfirmTarget] = useState<{ pending: PendingSubstitution; substitute: Product } | null>(
    null
  );
  const [confirmDiscount, setConfirmDiscount] = useState('');

  const load = useCallback(async () => {
    try {
      setProducts(await listProducts(shopId, true)); // fetch everything, filter in the UI
      setError(null);
    } catch {
      setError('โหลดรายการสินค้าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  // ใช้ร่วมกันทั้งฟอร์ม "เพิ่มสินค้า" บนสุดและฟอร์มแก้ไข inline ในแถว — ต่างกันแค่ค่าที่ตรวจ
  // และ setter ของ error ที่จะโชว์
  const validateProductInput = (
    nameValue: string,
    priceValue: string,
    onError: (msg: string) => void
  ): number | null => {
    if (!nameValue.trim()) {
      onError('กรอกชื่อสินค้าก่อน');
      return null;
    }
    const price = Number(priceValue);
    if (!Number.isFinite(price) || price < 0) {
      onError('กรอกราคาเป็นตัวเลขไม่ติดลบ');
      return null;
    }
    return price;
  };

  const onAdd = async () => {
    setFormError(null);
    const priceValue = validateProductInput(name, price, setFormError);
    if (priceValue === null) return;

    setBusy(true);
    try {
      await createProduct(shopId, { name: name.trim(), price_baht: priceValue });
      setName('');
      setPrice('');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'เพิ่มสินค้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // แก้ไขเกิด inline ที่ตัวแถวนั้นเลย — ไม่แตะ name/price/formError ของฟอร์ม "เพิ่มสินค้า"
  // บนสุดเลย กันไม่ให้ทั้งสองฟอร์มชนกันถ้าเผลอเปิดพร้อมกัน
  const onStartEdit = (product: Product) => {
    setEditingId(product.id);
    setEditName(product.name);
    setEditPrice(String(product.priceBaht));
    setEditFormError(null);
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditPrice('');
    setEditFormError(null);
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    setEditFormError(null);
    const priceValue = validateProductInput(editName, editPrice, setEditFormError);
    if (priceValue === null) return;

    setBusy(true);
    try {
      await updateProduct(editingId, { name: editName.trim(), price_baht: priceValue });
      onCancelEdit();
      await load();
    } catch (err) {
      setEditFormError(err instanceof ApiError ? err.message : 'แก้ไขสินค้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  // Checks whether the just-archived product is still linked to any of the shop's active
  // events, and if so queues one substitution prompt per such event. Runs after the archive
  // already succeeded and never surfaces its own error as a failure — worst case, the
  // prompt just doesn't appear and the vendor links a replacement later by hand.
  const checkForSubstitutionPrompt = async (product: Product) => {
    try {
      const events = await apiRequest<
        { id: string; title: string; status: string; products: { id: string; discount_value_baht: number }[] }[]
      >(`/v1/shops/${shopId}/events`);
      const affected = events.filter(
        (e) => e.status === 'active' && e.products.some((p) => p.id === product.id)
      );
      if (affected.length > 0) {
        setPendingSubstitutions(
          affected.map((e) => ({
            eventId: e.id,
            eventTitle: e.title,
            outOfStockProductId: product.id,
            outOfStockProductName: product.name,
            outOfStockDiscount: e.products.find((p) => p.id === product.id)?.discount_value_baht ?? 0,
          }))
        );
      }
    } catch {
      // best-effort, see comment above
    }
  };

  // Confirm dialog ก่อนซ่อนยังเป็น Alert ตั้งใจ — เป็น destructive confirm ไม่ใช่ error display
  const onArchive = (product: Product) => {
    Alert.alert(
      'ซ่อนสินค้า',
      `ซ่อน "${product.name}" จากรายการ? Event ที่ใช้สินค้านี้อยู่แล้วจะยังแสดงตามเดิม แต่จะเลือกใส่ Event ใหม่ไม่ได้`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ซ่อน',
          style: 'destructive',
          onPress: async () => {
            setListActionError(null);
            try {
              await archiveProduct(product.id);
              await load();
              await checkForSubstitutionPrompt(product);
            } catch {
              setListActionError('ซ่อนสินค้าไม่สำเร็จ');
            }
          },
        },
      ]
    );
  };

  const onChooseSubstitute = async (pending: PendingSubstitution, substitute: Product, discountValue: number) => {
    setSubstitutingEventId(pending.eventId);
    setSubstituteError(null);
    try {
      await apiRequest(`/v1/events/${pending.eventId}/products/substitute`, {
        method: 'POST',
        body: {
          out_of_stock_product_id: pending.outOfStockProductId,
          substitute_product_id: substitute.id,
          discount_value_baht: discountValue,
        },
      });
      setPendingSubstitutions((prev) => prev.filter((p) => p.eventId !== pending.eventId));
      setConfirmTarget(null);
    } catch (err) {
      setSubstituteError(err instanceof ApiError ? err.message : 'ผูกสินค้าทดแทนไม่สำเร็จ');
    } finally {
      setSubstitutingEventId(null);
    }
  };

  const onConfirmSubstituteDiscount = () => {
    if (!confirmTarget) return;
    const value = Number(confirmDiscount);
    if (!Number.isFinite(value) || value < 0) {
      setSubstituteError('มูลค่าส่วนลดไม่ถูกต้อง');
      return;
    }
    onChooseSubstitute(confirmTarget.pending, confirmTarget.substitute, value);
  };

  const dismissPendingSubstitution = (eventId: string) => {
    setPendingSubstitutions((prev) => prev.filter((p) => p.eventId !== eventId));
    setConfirmTarget((prev) => (prev?.pending.eventId === eventId ? null : prev));
  };

  const onRestore = async (product: Product) => {
    setListActionError(null);
    try {
      await updateProduct(product.id, { status: 'active' });
      await load();
    } catch {
      setListActionError('กู้คืนสินค้าไม่สำเร็จ');
    }
  };

  const onPickImage = async (product: Product) => {
    setListActionError(null);
    // Every step here can throw (permissions, the picker, the native image manipulator);
    // without the try the rejection is swallowed and nothing happens on screen.
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setListActionError('ต้องขออนุญาตเข้าถึงคลังรูปภาพก่อน');

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;

      setUploadingId(product.id);
      const asset = await toJpegAsset(result.assets[0], 0);
      await uploadProductImage(product.id, buildSingleImageFormData(asset));
      await load();
    } catch (err) {
      setListActionError(err instanceof ApiError ? err.message : 'อัปโหลดรูปไม่สำเร็จ');
    } finally {
      setUploadingId(null);
    }
  };

  if (loading) return <LoadingView label="กำลังโหลดสินค้า..." />;

  const visible = showArchived ? products : products.filter((p) => p.status === 'active');
  const archivedCount = products.filter((p) => p.status === 'archived').length;

  return (
    <View style={styles.container}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <ErrorBanner message={error} />
            <ErrorBanner message={listActionError} />
            <Text style={styles.intro}>
              สินค้าใช้ระบุว่า Event ไหนลดเฉพาะอะไร · Event ที่ไม่เลือกสินค้าเลย = ลดทั้งร้าน
            </Text>

            {pendingSubstitutions.length > 0 && (
              <View style={styles.substituteSection}>
                <ErrorBanner message={substituteError} />
                {pendingSubstitutions.map((pending) => {
                  const choices = products.filter(
                    (p) => p.status === 'active' && p.id !== pending.outOfStockProductId
                  );
                  const isSubmitting = substitutingEventId === pending.eventId;
                  return (
                    <View key={pending.eventId} style={styles.substituteCard}>
                      <Text style={styles.substituteTitle}>
                        &quot;{pending.outOfStockProductName}&quot; หมด — Event &quot;{pending.eventTitle}&quot; ยังใช้สินค้านี้อยู่
                      </Text>
                      <Text style={styles.substituteHint}>เลือกสินค้าทดแทนให้ Event นี้ไหม?</Text>
                      {confirmTarget?.pending.eventId === pending.eventId ? (
                        <View style={styles.substituteConfirmPanel}>
                          <Text style={styles.substituteHint}>
                            เปลี่ยนเป็น &quot;{confirmTarget.substitute.name}&quot; — ยืนยันส่วนลด
                          </Text>
                          <FormField
                            label="ส่วนลด (บาท)"
                            value={confirmDiscount}
                            onChangeText={setConfirmDiscount}
                            keyboardType="numeric"
                            placeholder="0"
                          />
                          <View style={styles.substituteConfirmRow}>
                            <PrimaryButton
                              title="ยกเลิก"
                              variant="secondary"
                              onPress={() => setConfirmTarget(null)}
                              disabled={isSubmitting}
                              style={styles.substituteConfirmBtn}
                            />
                            <PrimaryButton
                              title={isSubmitting ? 'กำลังยืนยัน...' : 'ยืนยัน'}
                              onPress={onConfirmSubstituteDiscount}
                              loading={isSubmitting}
                              disabled={isSubmitting}
                              style={styles.substituteConfirmBtn}
                            />
                          </View>
                        </View>
                      ) : choices.length > 0 ? (
                        <View style={styles.substituteChipRow}>
                          {choices.map((p) => (
                            <TouchableOpacity
                              key={p.id}
                              style={styles.substituteChip}
                              disabled={isSubmitting}
                              onPress={() => {
                                setConfirmTarget({ pending, substitute: p });
                                setConfirmDiscount(String(pending.outOfStockDiscount));
                                setSubstituteError(null);
                              }}
                            >
                              <Text style={styles.substituteChipText}>{p.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.substituteHint}>ยังไม่มีสินค้าอื่นที่ใช้งานอยู่ให้เลือกเป็นสินค้าทดแทน</Text>
                      )}
                      <Pressable onPress={() => dismissPendingSubstitution(pending.eventId)} hitSlop={8} disabled={isSubmitting}>
                        <Text style={styles.toggle}>ข้าม</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.addCard}>
              <Text style={styles.cardTitle}>เพิ่มสินค้า</Text>
              <ErrorBanner message={formError} />
              <View style={styles.formRow}>
                <View style={{ flex: 2, marginRight: spacing.sm }}>
                  <FormField label="ชื่อสินค้า" value={name} onChangeText={setName} placeholder="เช่น กาแฟเย็น" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField
                    label="ราคา (บาท)"
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="numeric"
                    placeholder="60"
                  />
                </View>
              </View>
              <PrimaryButton title="เพิ่มสินค้า" onPress={onAdd} loading={busy} />
            </View>
            {archivedCount > 0 ? (
              <Pressable onPress={() => setShowArchived((v) => !v)} hitSlop={8}>
                <Text style={styles.toggle}>
                  {showArchived ? 'ซ่อนรายการที่ซ่อนอยู่' : `แสดงสินค้าที่ซ่อนอยู่ (${archivedCount})`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="cube-outline" size={44} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>ยังไม่มีสินค้า</Text>
            <Text style={styles.emptySubtitle}>เพิ่มสินค้าของคุณเพื่อเริ่มสร้าง Event</Text>
          </View>
        }
        renderItem={({ item }) => {
          const archived = item.status === 'archived';

          // แก้ไข inline ตรงแถวนี้เลย — แทนที่เนื้อแถวทั้งหมดด้วยฟอร์มแก้ไข แทนการเลื่อนขึ้นไป
          // ใช้ฟอร์ม "เพิ่มสินค้า" บนสุดร่วมกัน (ของเดิม กดแก้ไขสินค้าตัวล่างๆ ในลิสต์ยาวๆ แล้วฟอร์ม
          // ไปโผล่บนสุดที่เลื่อนพ้นสายตาไปแล้ว งง)
          if (editingId === item.id) {
            return (
              <View style={[styles.row, styles.rowEditing]}>
                <ErrorBanner message={editFormError} />
                <View style={styles.formRow}>
                  <View style={{ flex: 2, marginRight: spacing.sm }}>
                    <FormField label="ชื่อสินค้า" value={editName} onChangeText={setEditName} placeholder="เช่น กาแฟเย็น" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormField
                      label="ราคา (บาท)"
                      value={editPrice}
                      onChangeText={setEditPrice}
                      keyboardType="numeric"
                      placeholder="60"
                    />
                  </View>
                </View>
                <View style={styles.editActionRow}>
                  <PrimaryButton
                    title="ยกเลิก"
                    variant="secondary"
                    onPress={onCancelEdit}
                    disabled={busy}
                    style={styles.editActionBtn}
                  />
                  <PrimaryButton
                    title="บันทึก"
                    onPress={onSaveEdit}
                    loading={busy}
                    style={styles.editActionBtn}
                  />
                </View>
              </View>
            );
          }

          return (
            <View style={[styles.row, archived && styles.rowArchived]}>
              <TouchableOpacity onPress={() => onPickImage(item)} disabled={uploadingId === item.id}>
                {resolveAssetUrl(item.imageUrl) ? (
                  <Image source={{ uri: resolveAssetUrl(item.imageUrl)! }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <Ionicons name="camera-outline" size={20} color={colors.textMuted} />
                  </View>
                )}
              </TouchableOpacity>
              <Pressable style={styles.rowBody} onPress={() => onStartEdit(item)} hitSlop={4}>
                <Text style={[styles.name, archived && styles.muted]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.price}>{Number(item.priceBaht).toLocaleString()} ฿</Text>
                {archived ? <Text style={styles.archivedTag}>ซ่อนอยู่</Text> : null}
              </Pressable>
              <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
              <Switch
                value={!archived}
                onValueChange={() => (archived ? onRestore(item) : onArchive(item))}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  intro: { fontSize: 13, color: colors.textMuted, lineHeight: 20 },
  addCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  substituteSection: { gap: spacing.sm },
  substituteCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  substituteTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  substituteHint: { fontSize: 12, color: colors.textMuted },
  substituteChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  substituteConfirmPanel: { gap: spacing.xs },
  substituteConfirmRow: { flexDirection: 'row', gap: spacing.sm },
  substituteConfirmBtn: { flex: 1 },
  substituteChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  substituteChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  formRow: { flexDirection: 'row' },
  toggle: { fontSize: 13, color: colors.primary, fontWeight: '700', paddingVertical: spacing.xs },
  emptyWrap: { alignItems: 'center', paddingTop: 40, paddingHorizontal: spacing.lg, gap: spacing.xs },
  emptyIconCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  emptySubtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.sm,
    ...shadows.card,
  },
  rowArchived: { opacity: 0.65 },
  rowEditing: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  editActionRow: { flexDirection: 'row', gap: spacing.sm },
  editActionBtn: { flex: 1 },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.background },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  rowBody: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  muted: { color: colors.textMuted },
  price: { fontSize: 13, color: colors.textMuted },
  archivedTag: { fontSize: 11, color: colors.textMuted },
});
