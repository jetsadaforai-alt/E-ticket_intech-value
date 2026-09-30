import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from './AppText';

type Props = {
  /** 1-5 (matches backend EventReview.rating), fractional allowed when displaying an average — rounds to nearest whole grade. */
  value: number;
  size?: number;
  /** Supply this to make grades tappable — tapping a letter selects its 1-5 value. */
  onChange?: (rating: number) => void;
  disabled?: boolean;
};

// เก็บ rating เป็น 1..5 เหมือนเดิมฝั่ง backend (ไม่ต้องแก้ schema/validation) แค่แปลงเป็นตัวอักษร
// ฝั่ง UI เท่านั้น — 5=A ... 1=F ตามที่ขอ แทนระบบดาว 5 ดวงเดิม
const GRADES: { rating: number; letter: string; color: string }[] = [
  { rating: 1, letter: 'F', color: '#BA1A1A' },
  { rating: 2, letter: 'D', color: '#C2620A' },
  { rating: 3, letter: 'C', color: '#9A6700' },
  { rating: 4, letter: 'B', color: '#00685F' },
  { rating: 5, letter: 'A', color: '#1A7F37' },
];

function gradeFor(rating: number) {
  const rounded = Math.min(5, Math.max(1, Math.round(rating)));
  return GRADES.find((g) => g.rating === rounded) ?? GRADES[0];
}

export function GradeRating({ value, size = 18, onChange, disabled }: Props) {
  const interactive = Boolean(onChange) && !disabled;

  // โหมดแสดงผลอย่างเดียว (ไม่มี onChange) — badge ตัวอักษรเดียวตามเกรดที่ปัด
  if (!onChange) {
    const grade = gradeFor(value);
    const badgeSize = size + 6;
    return (
      <View
        style={[
          styles.badge,
          { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: grade.color },
        ]}
      >
        <Text style={[styles.badgeText, { fontSize: size * 0.62 }]}>{grade.letter}</Text>
      </View>
    );
  }

  // โหมดเลือก — ชิป 5 ตัว F D C B A ให้แตะเลือก
  const selected = value > 0 ? Math.round(value) : 0;
  return (
    <View style={styles.row}>
      {GRADES.map((g) => {
        const isSelected = g.rating === selected;
        return (
          <Pressable
            key={g.rating}
            onPress={() => onChange(g.rating)}
            disabled={!interactive}
            hitSlop={4}
            style={[
              styles.chip,
              { width: size, height: size, borderRadius: size / 2, borderColor: g.color },
              isSelected && { backgroundColor: g.color },
              disabled && styles.disabled,
            ]}
          >
            <Text style={[styles.chipText, { fontSize: size * 0.4, color: isSelected ? '#fff' : g.color }]}>
              {g.letter}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontWeight: '800' },
  chip: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  chipText: { fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
