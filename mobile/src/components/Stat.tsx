import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { vendorColors as colors, radius, spacing } from '../theme';

/** A single labeled number, used in a row wherever a vendor screen needs to show a few
 * counters side by side (shop summary, quota, event-compare). Extracted out of
 * ShopDashboardScreen so EventCompareScreen doesn't have to redeclare the same component. */
export function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },
});
