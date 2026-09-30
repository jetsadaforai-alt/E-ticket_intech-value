import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './AppText';
import { PrimaryButton } from './PrimaryButton';
import { useColors } from '../hooks/useColors';
import { colors, spacing, type } from '../theme';

/**
 * "Nothing here yet" — an icon, a one-line reason, an optional hint and an optional
 * next step, so an empty list reads as an invitation to act rather than a dead end.
 */
export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { backgroundColor: c.primarySoft }]}>
        <Ionicons name={icon} size={30} color={c.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <PrimaryButton title={actionLabel} variant="secondary" onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { ...type.subheading, color: colors.text, textAlign: 'center' },
  hint: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 300 },
  action: { marginTop: spacing.sm, alignSelf: 'stretch' },
});
