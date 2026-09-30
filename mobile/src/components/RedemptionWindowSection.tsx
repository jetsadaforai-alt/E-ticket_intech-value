import React, { useEffect, useState } from 'react';
import { View, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './AppText';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { FormField } from './FormField';
import { PrimaryButton } from './PrimaryButton';
import { DAY_OPTIONS, type RedemptionWindowController } from '../hooks/useRedemptionWindow';
// โหมดร้านค้าใช้โทนน้ำเงิน — หน้านี้เข้าถึงได้จากโหมด vendor เท่านั้น (useRequireMode การันตี)
// จึงผูก palette แบบ static ได้ ไม่ต้องอ่านโหมดตอน runtime
import { vendorColors as colors, radius, spacing } from '../theme';

type Props = {
  window: RedemptionWindowController;
  /** EventFormScreen's edit mode puts its clear-window button here; create mode passes
   * nothing. */
  footer?: React.ReactNode;
  hint?: string;
};

const DEFAULT_HINT =
  'ถ้าอยากให้ลูกค้าแลกตั๋วได้เฉพาะบางวัน/บางช่วงเวลาเท่านั้น (เช่น เฉพาะเสาร์-อาทิตย์ 18:00-20:00) ตั้งค่าด้านล่างนี้ได้ — เว้นว่างทั้งหมด = ลูกค้าแลกตั๋วได้ทุกวันทุกเวลาตลอดอายุ Event (ไม่บังคับตั้งค่า)';

// No card background/shadow of its own — EventFormScreen embeds this inside its own
// card, one section among several, so it just needs a divider from what's above it.
//
// The "ใช้สิทธิ์ได้ตั้งแต่/ถึงวันที่" range that useRedemptionWindow's validFrom/validUntil
// track has no input here on purpose: it duplicated the event's own start/end date shown
// right above in the same card. The fields still exist in the controller and still ride
// along in toPayload() (as null, since nothing sets them from this UI) — only the picker
// UI for them was removed.
// พิมพ์ "HH:mm" เองแล้วผู้ใช้บ่นว่ายุ่งยาก — เปลี่ยนมาใช้ picker แบบเลื่อนเลือกแทน (ตัวเดียวกับที่
// ใช้เลือกวันเวลาเริ่ม/สิ้นสุด Event อยู่แล้วใน EventFormScreen) เก็บ state เป็น "HH:mm" string
// เหมือนเดิมทุกอย่างใน useRedemptionWindow — แปลงแค่ตอนแสดงผล/ตอนเลือกเท่านั้น
function parseTimeToDate(hhmm: string): Date {
  const d = new Date();
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (match) d.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return d;
}
function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function RedemptionWindowSection({ window: w, footer, hint = DEFAULT_HINT }: Props) {
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);
  // พับเก็บไว้เป็นค่าเริ่มต้น (เป็น section ที่ไม่บังคับตั้งค่า) — เปิดอัตโนมัติถ้ามีช่วงเวลาอยู่แล้ว
  // (เช่น hydrate มาจาก event เดิมตอนแก้ไข ซึ่งมาถึงหลัง mount แรก จึงต้องใช้ effect ไม่ใช่แค่
  // ค่าเริ่มต้นของ useState เฉยๆ) ผู้ใช้ปิดเองทีหลังได้ตามปกติ
  const [open, setOpen] = useState(w.slots.length > 0);
  useEffect(() => {
    if (w.slots.length > 0) setOpen(true);
  }, [w.slots.length]);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>ช่วงเวลาที่ลูกค้าแลกตั๋วได้</Text>
      <Text style={styles.muted}>{hint}</Text>

      <Pressable style={styles.accordionToggle} onPress={() => setOpen((v) => !v)} hitSlop={8}>
        <Text style={styles.accordionToggleText}>
          {open ? '▾' : '▸'} {w.slots.length > 0 ? `ตั้งไว้แล้ว ${w.slots.length} ช่วงเวลา` : 'ตั้งค่าช่วงเวลา'}
        </Text>
      </Pressable>

      {open && (
        <>
          <Text style={styles.subLabel}>เพิ่มวัน/ช่วงเวลาที่อนุญาตให้แลกตั๋ว (ซ้ำทุกสัปดาห์)</Text>
          {w.slots.length > 0 ? (
            <View style={styles.slotList}>
              {w.slots.map((slot, index) => (
                <View key={`${slot.dayOfWeek}-${slot.startTime}-${index}`} style={styles.slotRow}>
                  <Text style={styles.slotText}>
                    {DAY_OPTIONS.find((d) => d.value === slot.dayOfWeek)?.label ?? slot.dayOfWeek} {slot.startTime}-{slot.endTime}
                  </Text>
                  <Pressable onPress={() => w.removeSlot(index)} hitSlop={8}>
                    <Text style={styles.slotRemove}>ลบ</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>ยังไม่มีช่วงเวลา (ใช้ได้ทุกเวลาภายในช่วงวันที่ด้านบน)</Text>
          )}

          <View style={styles.dayChipsRow}>
            {DAY_OPTIONS.map((day) => {
              const selected = w.newSlotDays.includes(day.value);
              return (
                <Pressable
                  key={day.value}
                  style={[styles.dayChip, selected && styles.dayChipSelected]}
                  onPress={() => w.toggleDay(day.value)}
                >
                  <Text style={[styles.dayChipText, selected && styles.dayChipTextSelected]}>{day.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <TouchableOpacity onPress={() => setPickerTarget('start')}>
                <View pointerEvents="none">
                  <FormField label="เวลาเริ่ม" value={w.newSlotStart} placeholder="แตะเพื่อเลือกเวลา" editable={false} />
                </View>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <TouchableOpacity onPress={() => setPickerTarget('end')}>
                <View pointerEvents="none">
                  <FormField label="เวลาสิ้นสุด" value={w.newSlotEnd} placeholder="แตะเพื่อเลือกเวลา" editable={false} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
          <PrimaryButton title="เพิ่มช่วงเวลา" variant="secondary" onPress={w.addSlotRows} />

          {w.error ? <Text style={styles.errorText}>{w.error}</Text> : null}
        </>
      )}

      {footer}

      <DateTimePickerModal
        isVisible={pickerTarget !== null}
        mode="time"
        date={parseTimeToDate(pickerTarget === 'start' ? w.newSlotStart : w.newSlotEnd)}
        onConfirm={(date) => {
          if (pickerTarget === 'start') w.setNewSlotStart(formatTime(date));
          else if (pickerTarget === 'end') w.setNewSlotEnd(formatTime(date));
          setPickerTarget(null);
        }}
        onCancel={() => setPickerTarget(null)}
        locale="th_TH"
        confirmTextIOS="ตกลง"
        cancelTextIOS="ยกเลิก"
        is24Hour
      />
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
  subLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: spacing.xs },
  accordionToggle: { marginTop: spacing.xs },
  accordionToggleText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  muted: { fontSize: 13, color: colors.textMuted },
  errorText: { fontSize: 13, color: colors.danger },
  row: { flexDirection: 'row' },
  slotList: { gap: spacing.xs },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  slotText: { fontSize: 13, color: colors.text },
  slotRemove: { fontSize: 12, color: colors.danger, fontWeight: '700' },
  dayChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dayChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  dayChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: 13, color: colors.text },
  dayChipTextSelected: { color: '#fff', fontWeight: '700' },
});
