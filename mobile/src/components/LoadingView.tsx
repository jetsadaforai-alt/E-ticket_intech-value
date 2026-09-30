import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { colors, spacing, type } from '../theme';
import { useColors } from '../hooks/useColors';

// Full-screen spinner for screens whose content has no fixed shape to skeleton
// (e.g. a ticket detail). List screens use components/Skeleton instead.
export function LoadingView({ label = 'กำลังโหลด...' }: { label?: string }) {
  const c = useColors();
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={c.primary} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  label: { ...type.bodySmall, color: colors.textMuted },
});
