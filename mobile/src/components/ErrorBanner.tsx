import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './AppText';
import { colors, radius, spacing, touch, type } from '../theme';

// เดิมเป็นกล่องสีข้อความเปล่าๆ ไม่มีไอคอน/เส้นขอบเลย ต่างจาก warning banner ทุกจุดใน
// design ที่ทำ mockup ไว้ (มีไอคอน + เส้นขอบสีจางๆ กำกับเสมอ) — เพิ่มให้ตรงกัน
//
// UI refresh 2026-09-27: optional `onRetry` adds a "ลองใหม่" button inside the banner,
// so a failed load always has a way forward. Screens that don't pass it look and
// behave exactly as before.
export function ErrorBanner({
  message,
  onRetry,
  retryLabel = 'ลองใหม่',
}: {
  message: string | null | undefined;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  if (!message) return null;
  return (
    <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={20} color={colors.danger} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity
          onPress={onRetry}
          style={styles.retry}
          accessibilityRole="button"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="refresh" size={16} color={colors.danger} />
          <Text style={styles.retryText}>{retryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(186, 26, 26, 0.25)',
    paddingVertical: spacing.sm,
    paddingHorizontal: 12,
  },
  icon: { alignSelf: 'flex-start', marginTop: 2 },
  text: { ...type.bodySmall, flex: 1, color: colors.danger },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: touch.min - 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(186, 26, 26, 0.35)',
  },
  retryText: { ...type.label, color: colors.danger },
});
