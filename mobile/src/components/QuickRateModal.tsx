import React from 'react';
import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { GradeRating } from './GradeRating';
import { colors, radius, spacing, shadows } from '../theme';

type Props = {
  visible: boolean;
  onPick: (rating: number) => void;
  onClose: () => void;
};

// แค่เลือกเกรดเร็วๆ ตรงนี้ — ไม่มีคอมเมนต์/แนบรูป/ปุ่มส่งเอง พอเลือกปุ๊บ TicketDetailScreen
// จะพาไปหน้า EventDetail ที่มีฟอร์มเต็มอยู่แล้วต่อ (เห็นคะแนนที่เลือกไว้ล่วงหน้า)
export function QuickRateModal({ visible, onPick, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>ให้คะแนน Event นี้ไหม?</Text>
          <GradeRating value={0} size={48} onChange={onPick} />
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.skip}>ข้ามไปก่อน</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(25,28,29,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
    ...shadows.card,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  skip: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
});
