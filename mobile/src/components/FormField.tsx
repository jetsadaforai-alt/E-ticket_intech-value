import React, { useState } from 'react';
import { StyleSheet, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from './AppText';
import { colors, radius, spacing, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Props = TextInputProps & {
  label: string;
  helperText?: string;
  /** Field-level error shown under the input (replaces helperText while set). */
  error?: string | null;
};

/**
 * Focus state (design pass 2026-09-17, "UI ยังไม่ดี"): border + a soft primary-tinted
 * glow on focus, colour picked up from whichever mode is active via useColors() — the
 * old version had zero focus feedback at all, every field looked identical whether it
 * was the one you were typing into or not.
 *
 * UI refresh 2026-09-27: 52px tall input on a white surface, 15/24 Thai-friendly text,
 * optional inline `error` under the field.
 */
export function FormField({ label, helperText, error, style, onFocus, onBlur, ...rest }: Props) {
  const c = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          // Android centres multiline text vertically by default; start at the top instead
          rest.multiline && styles.multiline,
          { borderColor: error ? c.danger : c.borderStrong, color: c.text },
          focused && {
            borderColor: error ? c.danger : c.primary,
            borderWidth: 2,
            shadowColor: c.primary,
            shadowOpacity: 0.16,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
            elevation: 2,
          },
          style,
        ]}
        placeholderTextColor="#6F7976"
        accessibilityLabel={label}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={c.danger} />
          <Text style={[styles.helper, { color: c.danger }]}>{error}</Text>
        </View>
      ) : helperText ? (
        <Text style={styles.helper}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { ...type.label, color: colors.text },
  input: {
    ...type.body,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  multiline: { textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  helper: { ...type.caption, color: colors.textMuted, flexShrink: 1 },
});
