import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type TouchableOpacityProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './AppText';
import { colors, radius, spacing, type } from '../theme';
import { useColors } from '../hooks/useColors';

type Variant = 'primary' | 'secondary' | 'danger';

type Props = Omit<TouchableOpacityProps, 'onPress'> & {
  title: string;
  variant?: Variant;
  loading?: boolean;
  /** Optional leading icon (Ionicons name). */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: (e: GestureResponderEvent) => void | Promise<unknown>;
};

/**
 * Brand colour comes from the current mode rather than the static palette — this
 * button appears in every mode, and vendor mode is blue while customer/staff are
 * teal. Only the colour is runtime; layout stays in the module-level StyleSheet.
 *
 * Press-scale (design pass 2026-08-22, "น่ากดน่าใช้") — the size/shape/flex-affecting
 * part of `style` goes on the outer Animated.View so callers doing `style={{ flex: 1 }}`
 * in a row (EventFormScreen's step nav, etc.) still work; the inner TouchableOpacity
 * just fills that box and centers its content.
 *
 * UI refresh 2026-09-27:
 * - min height 52 (touch target ≥44 with room for Thai text)
 * - disabled is a neutral grey fill, not the brand colour at 50% — white text on
 *   half-transparent teal failed contrast; loading keeps the brand colour + spinner so
 *   it reads as "working", not "unavailable"
 * - double-tap guard: a second press is ignored while an async onPress is still running
 *   (and for a short beat after a sync one), so a quick double tap can't submit twice
 */
export function PrimaryButton({
  title,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const c = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);

  const animateTo = (toValue: number) =>
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const handlePress = async (e: GestureResponderEvent) => {
    if (busy.current || !onPress) return;
    busy.current = true;
    try {
      await onPress(e);
    } finally {
      setTimeout(() => {
        busy.current = false;
      }, 350);
    }
  };

  const inactive = disabled && !loading;

  const fill = inactive
    ? { backgroundColor: colors.surfaceHigh, borderWidth: 0 }
    : variant === 'primary'
      ? {
          backgroundColor: c.primary,
          shadowColor: c.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.24,
          shadowRadius: 10,
          elevation: 3,
        }
      : { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: variant === 'danger' ? c.danger : c.primary };

  const textColor = inactive
    ? colors.textMuted
    : variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? c.danger
        : c.primary;

  return (
    <Animated.View style={[styles.base, fill, loading && styles.loading, style, { transform: [{ scale }] }]}>
      <TouchableOpacity
        style={styles.touchable}
        activeOpacity={0.85}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
        onPress={handlePress}
        onPressIn={(e) => {
          animateTo(0.97);
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          animateTo(1);
          onPressOut?.(e);
        }}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : c.primary} />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
            <Text style={[styles.text, { color: textColor }]} numberOfLines={2}>
              {title}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Figma redesign: buttons are fully pill-shaped, not the old radius.md rounded-rect.
  base: {
    borderRadius: radius.pill,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchable: { width: '100%', minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loading: { opacity: 0.85 },
  text: { ...type.button, textAlign: 'center' },
});
