import React, { useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from './AppText';
import { Ionicons } from '@expo/vector-icons';
import type { EventProductsController } from '../hooks/useEventProducts';
import { ApiError } from '../api/client';
import { FormField } from './FormField';
import { PrimaryButton } from './PrimaryButton';
import { ErrorBanner } from './ErrorBanner';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, spacing } from '../theme';

type Props = {
  products: EventProductsController;
  /** Manage screen puts its save button here; the create screen passes nothing. */
  footer?: React.ReactNode;
  hint?: string;
  /** Shown when the shop has no products yet, to point at where they're created. */
  onManageProducts?: () => void;
};

const DEFAULT_HINT = 'ไม่เลือกเลย = ส่วนลดใช้ได้กับทุกอย่างในร้าน (ไม่บังคับเลือก)';

// No card background/shadow of its own — EventFormScreen embeds this inside its own
// card, one section among several, so it just needs a divider from what's above it.
export function ProductPickerSection({ products: p, footer, hint = DEFAULT_HINT, onManageProducts }: Props) {
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  // พับเก็บไว้เป็นค่าเริ่มต้น (ไม่บังคับใช้ฟอร์มนี้เลยก็ได้) กันสเต็ป 2 ของ EventFormScreen ยาวเกิน
  // ไปตั้งแต่เปิดหน้ามา — แตะเพื่อกางออกเองตอนต้องการสร้างสินค้าใหม่จริงๆ
  const [createOpen, setCreateOpen] = useState(false);

  // ไม่ผ่าน validateForm ของ ShopProductsScreen เพราะฟอร์มนี้เล็กกว่ามาก (ไม่มี archive/
  // แก้ไข) เขียนแยกเองสั้นๆ ตรงนี้พอ
  const onCreate = async () => {
    setCreateError(null);
    if (!newName.trim()) {
      setCreateError('กรอกชื่อสินค้าก่อน');
      return;
    }
    const priceValue = Number(newPrice);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      setCreateError('กรอกราคาเป็นตัวเลขไม่ติดลบ');
      return;
    }
    try {
      await p.createAndSelect({ name: newName.trim(), price_baht: priceValue });
      setNewName('');
      setNewPrice('');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'สร้างสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>สินค้าที่ร่วมรายการ</Text>
      <Text style={styles.muted}>{hint}</Text>

      {p.loading ? (
        <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.primary} />
      ) : p.available.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.muted}>ร้านยังไม่มีสินค้าในระบบ</Text>
          {onManageProducts ? (
            <Pressable onPress={onManageProducts} hitSlop={8}>
              <Text style={styles.link}>ไปเพิ่มสินค้า</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.list}>
          {p.available.map((product) => {
            const selected = p.selectedIds.includes(product.id);
            const archived = product.status === 'archived';
            return (
              <Pressable
                key={product.id}
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => p.toggle(product.id)}
              >
                <Ionicons
                  name={selected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={selected ? colors.primary : colors.border}
                />
                <View style={styles.rowText}>
                  <Text style={[styles.name, archived && styles.nameArchived]} numberOfLines={1}>
                    {product.name}
                  </Text>
                  {archived ? <Text style={styles.archivedTag}>ซ่อนอยู่</Text> : null}
                </View>
                <Text style={styles.price}>{Number(product.priceBaht).toLocaleString()} ฿</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {p.selectedIds.length > 0 ? (
        <Text style={styles.muted}>เลือกไว้ {p.selectedIds.length} รายการ</Text>
      ) : (
        <Text style={styles.muted}>ยังไม่ได้เลือก — ส่วนลดจะใช้ได้ทั้งร้าน</Text>
      )}

      {p.error ? <Text style={styles.errorText}>{p.error}</Text> : null}

      <Pressable style={styles.accordionToggle} onPress={() => setCreateOpen((v) => !v)} hitSlop={8}>
        <Text style={styles.accordionToggleText}>{createOpen ? '▾' : '▸'} หรือสร้างสินค้าใหม่</Text>
      </Pressable>

      {createOpen && (
        <View style={styles.createBox}>
          <ErrorBanner message={createError} />
          <View style={styles.createRow}>
            <View style={{ flex: 2, marginRight: spacing.sm }}>
              <FormField label="ชื่อสินค้า" value={newName} onChangeText={setNewName} placeholder="เช่น กาแฟเย็น" />
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="ราคา (บาท)" value={newPrice} onChangeText={setNewPrice} keyboardType="numeric" placeholder="60" />
            </View>
          </View>
          <PrimaryButton
            title={p.creating ? 'กำลังสร้าง...' : '+ เพิ่มสินค้าใหม่'}
            variant="secondary"
            onPress={onCreate}
            loading={p.creating}
          />
        </View>
      )}

      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  errorText: { fontSize: 13, color: colors.danger },
  link: { fontSize: 13, color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  emptyBox: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.xs },
  accordionToggle: { marginTop: spacing.xs },
  accordionToggleText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  createBox: { gap: spacing.sm, marginTop: spacing.xs },
  createRow: { flexDirection: 'row' },
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowSelected: { borderColor: colors.primary },
  rowText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontSize: 14, color: colors.text, flexShrink: 1 },
  nameArchived: { color: colors.textMuted },
  archivedTag: { fontSize: 11, color: colors.textMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 4 },
  price: { fontSize: 13, color: colors.textMuted },
});
