import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

/**
 * Grey placeholder that pulses while content loads — shows the shape of what's coming
 * instead of a centred spinner, so the screen doesn't jump when data arrives.
 * Pulse is skipped when the OS "reduce motion" setting is on.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  rounded = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.surfaceHigh, opacity }, style]}
    />
  );
}

/** Card-shaped placeholder matching EventCard's layout (image + title + footer). */
export function EventCardSkeleton() {
  return (
    <View style={styles.card} accessibilityLabel="กำลังโหลด" accessible>
      <Skeleton height={192} rounded={0} />
      <View style={styles.body}>
        <Skeleton width="70%" height={20} />
        <Skeleton width="45%" height={14} />
        <Skeleton height={52} rounded={radius.pill} style={{ marginTop: spacing.sm }} />
      </View>
    </View>
  );
}

/** Row-shaped placeholder for lists (chat, support, notifications, tickets). */
export function ListRowSkeleton() {
  return (
    <View style={styles.row} accessibilityLabel="กำลังโหลด" accessible>
      <Skeleton width={48} height={48} rounded={24} />
      <View style={styles.rowText}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="85%" height={13} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 4, variant = 'row' }: { count?: number; variant?: 'row' | 'card' }) {
  return (
    <View style={variant === 'row' ? styles.listRows : styles.listCards}>
      {Array.from({ length: count }, (_, i) =>
        variant === 'row' ? <ListRowSkeleton key={i} /> : <EventCardSkeleton key={i} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  body: { padding: 21, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: spacing.sm },
  listRows: { padding: spacing.md, gap: spacing.sm },
  listCards: { padding: spacing.md },
});
