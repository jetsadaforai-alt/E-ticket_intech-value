import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../components/AppText';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { apiRequest, ApiError } from '../api/client';
import BottomTabBar from '../components/BottomTabBar';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { useRequireMode } from '../hooks/useRequireMode';
import { useColors } from '../hooks/useColors';
import { colors, radius, shadows, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Scanner'>;

type ScannedProduct = { id: string; name: string; price_baht: string; status: string; discount_value_baht: string };

type ScanResult =
  | {
      kind: 'success';
      redemptionId: string;
      shopId: string;
      /** null while discountPending is true — the real amount isn't known until the
       * product-confirm step below resolves it. */
      discount: string | null;
      discountPending: boolean;
      eventTitle: string;
      wrongEvent: boolean;
      /** Empty = no restriction, the discount applies to anything in the shop. */
      products: ScannedProduct[];
    }
  | { kind: 'error'; message: string };

// A confirmation choice the staff member makes after a successful scan whose event
// links one or more products — never auto-picked, even when there's exactly one
// product, because that one item can be out of stock too.
type ProductChoice = { kind: 'product'; productId: string } | { kind: 'unavailable' };

const ERROR_TH: Record<string, string> = {
  QR_EXPIRED: 'QR หมดอายุแล้ว ให้ลูกค้าเปิดหน้าตั๋วใหม่',
  TICKET_NOT_FOUND: 'ไม่พบตั๋วนี้',
  FORBIDDEN: 'คุณไม่มีสิทธิ์สแกนของร้านนี้',
  TICKET_NOT_REDEEMABLE: 'ตั๋วนี้ใช้ไปแล้ว หรือถูกยกเลิก',
  EVENT_ENDED: 'Event นี้หมดเวลาแล้ว',
  OUTSIDE_REDEMPTION_WINDOW: 'อยู่นอกช่วงเวลาที่กำหนดให้ใช้สิทธิ์',
};

export default function ScannerScreen({ route, navigation }: Props) {
  const { eventTitle } = route.params ?? {};
  const { me } = useAuth();
  // vendor mode reaches this from the dashboard's scan button — owners work the counter too
  useRequireMode(['vendor', 'staff'], () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }));
  // เข้าได้ทั้ง vendor (น้ำเงิน) และ staff (เขียว) — จุดที่ใช้สี primary ต้องอ่านตามโหมดจริง
  // แทนสี colors เดิมที่ hardcode เขียวไว้ (ค่าอื่นที่ไม่ใช่ primary เหมือนกันทั้งสอง palette)
  const c = useColors();
  const isStaff = Boolean(me?.roles.shopStaff.length);
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<ScanResult | null>(null);
  const scanLockRef = useRef(false); // prevents firing multiple scans for the same frame burst

  // Product-confirm step (only relevant when result.products.length > 0) — a choice made
  // on screen, then submitted separately via "ยืนยัน" so a busy counter never fat-fingers
  // a submit mid-tap. Never auto-submitted, even with only one product on offer.
  const [choice, setChoice] = useState<ProductChoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedDiscount, setConfirmedDiscount] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: eventTitle ? `สแกน: ${eventTitle}` : 'สแกน QR',
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('StaffToday')} hitSlop={8} style={styles.headerAction}>
          <Ionicons name="list-outline" size={18} color={c.primary} />
          <Text style={[styles.headerActionText, { color: c.primary }]}>สรุปวันนี้</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, eventTitle]);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;

    setChoice(null);
    setConfirmed(false);
    setConfirmedDiscount(null);
    setConfirmError(null);

    try {
      const res = await apiRequest<{
        redemption_id: string;
        shop_id: string;
        discount_value_baht: string | null;
        discount_pending: boolean;
        event_title: string;
        products: ScannedProduct[];
      }>('/v1/staff/scan', {
        method: 'POST',
        body: { token: data },
      });
      // The backend has no event filter — it redeems whatever valid ticket of this
      // shop was scanned. When the staff picked a specific event, flag a mismatch
      // here so they at least see it happened (the redemption already went through).
      setResult({
        kind: 'success',
        redemptionId: res.redemption_id,
        shopId: res.shop_id,
        discount: res.discount_value_baht,
        discountPending: res.discount_pending,
        eventTitle: res.event_title,
        wrongEvent: Boolean(eventTitle && res.event_title !== eventTitle),
        products: res.products ?? [],
      });
    } catch (err) {
      const key = err instanceof ApiError ? err.message : '';
      setResult({ kind: 'error', message: ERROR_TH[key] ?? 'สแกนไม่สำเร็จ' });
    }
  };

  const scanAgain = () => {
    setResult(null);
    setChoice(null);
    setConfirmed(false);
    setConfirmedDiscount(null);
    setConfirmError(null);
    scanLockRef.current = false;
  };

  const confirmProduct = async (redemptionId: string) => {
    if (!choice) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await apiRequest<{ discount_value_baht: string }>(`/v1/staff/redemptions/${redemptionId}/product`, {
        method: 'PATCH',
        body: choice.kind === 'product' ? { product_id: choice.productId } : { unavailable: true },
      });
      setConfirmedDiscount(res.discount_value_baht);
      setConfirmed(true);
    } catch {
      setConfirmError('ยืนยันไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setConfirming(false);
    }
  };

  if (!isStaff) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.permissionText}>หน้านี้ใช้ได้เฉพาะพนักงาน/เจ้าของร้านที่ active อยู่เท่านั้น</Text>
        </View>
        <BottomTabBar active="Scanner" navigation={navigation} />
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered} />
        <BottomTabBar active="Scanner" navigation={navigation} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.permissionText}>ต้องขออนุญาตใช้กล้องเพื่อสแกน QR</Text>
          <TouchableOpacity style={[styles.button, { backgroundColor: c.primary }]} onPress={requestPermission}>
            <Text style={styles.buttonText}>อนุญาตใช้กล้อง</Text>
          </TouchableOpacity>
        </View>
        <BottomTabBar active="Scanner" navigation={navigation} />
      </View>
    );
  }

  if (result) {
    const isSuccess = result.kind === 'success';
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <View style={styles.resultCard}>
            {isSuccess ? (
              <View style={[styles.successGlow, { backgroundColor: c.primaryPill }]}>
                <View style={[styles.successCircle, { backgroundColor: c.primary }]}>
                  <Ionicons name="checkmark" size={44} color="#fff" />
                </View>
              </View>
            ) : (
              <View style={styles.errorCircle}>
                <Ionicons name="close" size={40} color={colors.danger} />
              </View>
            )}
            <Text style={styles.resultTitle}>{isSuccess ? 'สแกนสำเร็จ' : 'สแกนไม่ผ่าน'}</Text>
            {isSuccess ? (
              <>
                <Text style={styles.resultDetail}>{result.eventTitle}</Text>
                {result.discountPending && !confirmed ? (
                  <Text style={styles.resultDiscountPending}>จะรู้ยอดหลังยืนยันสินค้า</Text>
                ) : (
                  <Text style={[styles.resultDiscount, { color: c.primary }]}>
                    ส่วนลด {confirmed ? confirmedDiscount : result.discount} บาท
                  </Text>
                )}
                {/* The staff member is at the counter deciding what to discount — say which
                    items this ticket covers, or make it explicit that it covers everything.
                    When it's narrowed to specific products, staff must check which one the
                    customer actually took and explicitly confirm — never auto-picked, even
                    when there's only one product, since that one can be out of stock too. */}
                {result.products.length > 0 ? (
                  confirmed ? (
                    <View style={styles.scopeBox}>
                      <Text style={[styles.confirmedText, { color: c.primary }]}>
                        {choice?.kind === 'unavailable'
                          ? '✓ บันทึกแล้ว: สินค้าหมด'
                          : `✓ บันทึกแล้ว: ${result.products.find((p) => p.id === (choice as { productId: string }).productId)?.name ?? ''}`}
                      </Text>
                      {choice?.kind === 'unavailable' && (
                        <TouchableOpacity
                          onPress={() => navigation.navigate('ShopProducts', { shopId: result.shopId })}
                          hitSlop={8}
                        >
                          <Text style={[styles.manageProductsLink, { color: c.primary }]}>ไปจัดการสินค้านี้ →</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <View style={styles.scopeBox}>
                      <Text style={styles.scopeTitle}>ลูกค้าเลือกสินค้าไหน?</Text>
                      {result.products.map((p) => {
                        const active = choice?.kind === 'product' && choice.productId === p.id;
                        return (
                          <TouchableOpacity
                            key={p.id}
                            style={[styles.productRow, active && { borderColor: c.primary, backgroundColor: c.primaryPill }]}
                            onPress={() => setChoice({ kind: 'product', productId: p.id })}
                          >
                            <Text style={[styles.scopeItem, active && { fontWeight: '700', color: c.primary }]}>
                              {p.name} ({Number(p.price_baht).toLocaleString()} ฿) — ลด {p.discount_value_baht} บาท
                              {p.status === 'archived' ? ' — หมด' : ''}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[
                          styles.productRow,
                          choice?.kind === 'unavailable' && { borderColor: c.primary, backgroundColor: c.primaryPill },
                        ]}
                        onPress={() => setChoice({ kind: 'unavailable' })}
                      >
                        <Text
                          style={[
                            styles.scopeItem,
                            styles.unavailableOptionText,
                            choice?.kind === 'unavailable' && { fontWeight: '700', color: c.primary },
                          ]}
                        >
                          สินค้าหมด / ไม่มีตรงกับที่ลูกค้าหยิบ
                        </Text>
                      </TouchableOpacity>
                      {confirmError && <Text style={styles.warning}>{confirmError}</Text>}
                      <PrimaryButton
                        title={confirming ? 'กำลังยืนยัน...' : 'ยืนยัน'}
                        onPress={() => confirmProduct(result.redemptionId)}
                        disabled={!choice || confirming}
                        loading={confirming}
                        style={styles.confirmProductBtn}
                      />
                    </View>
                  )
                ) : (
                  <Text style={styles.scopeAll}>ใช้ได้กับทุกอย่างในร้าน</Text>
                )}
                {result.wrongEvent && (
                  <Text style={styles.warning}>
                    หมายเหตุ: ตั๋วใบนี้เป็นของ Event อื่น ไม่ใช่ &quot;{eventTitle}&quot; ที่เลือกไว้ (ใช้สิทธิ์ไปแล้ว)
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.resultDetail}>{result.message}</Text>
            )}
            <PrimaryButton title="สแกนต่อ" onPress={scanAgain} style={styles.fullWidthBtn} />
          </View>
        </View>
        <BottomTabBar active="Scanner" navigation={navigation} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            {eventTitle ? `กำลังสแกนให้: ${eventTitle}` : 'วาง QR ของลูกค้าในกรอบ'}
          </Text>
        </View>
      </View>
      <BottomTabBar active="Scanner" navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  cameraWrap: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  headerActionText: { color: colors.primary, fontWeight: '700' },
  permissionText: { fontSize: 16, textAlign: 'center', color: colors.text },
  overlay: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  overlayText: { color: '#fff', fontSize: 14, backgroundColor: 'rgba(0,0,0,0.5)', padding: spacing.sm, borderRadius: radius.sm },
  resultCard: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  successGlow: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: colors.primaryPill,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  successCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  errorCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.dangerBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  resultTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  resultDetail: { fontSize: 16, textAlign: 'center', color: colors.text },
  resultDiscount: { fontSize: 20, fontWeight: '700', color: colors.primary },
  resultDiscountPending: { fontSize: 14, fontWeight: '600', color: colors.textMuted, fontStyle: 'italic' },
  warning: { fontSize: 13, color: colors.warning, textAlign: 'center', fontWeight: '600' },
  scopeBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.neutralBubble,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  scopeTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  scopeItem: { fontSize: 14, color: colors.text },
  scopeAll: { fontSize: 13, color: colors.textMuted },
  productRow: {
    alignSelf: 'stretch',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginTop: 4,
  },
  productRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryPill },
  productRowTextActive: { fontWeight: '700', color: colors.primary },
  unavailableOptionText: { color: colors.danger },
  confirmProductBtn: { alignSelf: 'stretch', marginTop: spacing.sm },
  confirmedText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  manageProductsLink: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
  fullWidthBtn: { alignSelf: 'stretch', marginTop: spacing.xs },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 14, paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
