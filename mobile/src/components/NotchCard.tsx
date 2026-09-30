import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp, type DimensionValue } from 'react-native';
import { colors, radius, shadows } from '../theme';

type Props = {
  children: React.ReactNode;
  /**
   * The color of whatever this card sits on top of. The "torn ticket" notch isn't a real
   * cutout — Figma fakes it by painting two circles the page's background color over the
   * card's edges, and that's the cheapest way to reproduce it in RN too (no SVG masking).
   * Defaults to the app background since that's what every current usage sits on.
   */
  notchBackgroundColor?: string;
  /** Where the notch pair sits, as a fraction of card height from the top (0-1). */
  notchAt?: number;
  /** Same idea as `notchAt`, but a fixed pixel offset — steadier when the section above the
   * notch has a known height and the card's total height varies with content below it. */
  notchAtPx?: number;
  style?: StyleProp<ViewStyle>;
};

const NOTCH_SIZE = 24;

export function NotchCard({ children, notchBackgroundColor = colors.background, notchAt, notchAtPx, style }: Props) {
  const top: DimensionValue | undefined =
    notchAtPx !== undefined
      ? notchAtPx
      : notchAt !== undefined
        ? (`${notchAt * 100}%` as DimensionValue)
        : undefined;
  return (
    <View style={[styles.card, style]}>
      {children}
      {top !== undefined ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.notch, { backgroundColor: notchBackgroundColor, left: -NOTCH_SIZE / 2, top }]}
          />
          <View
            pointerEvents="none"
            style={[styles.notch, { backgroundColor: notchBackgroundColor, right: -NOTCH_SIZE / 2, top }]}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...shadows.card,
  },
  notch: {
    position: 'absolute',
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    marginTop: -NOTCH_SIZE / 2,
  },
});
