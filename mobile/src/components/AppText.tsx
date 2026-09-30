import React, { forwardRef } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { fonts } from '../theme';

/**
 * Drop-in replacements for React Native's Text/TextInput that render in IBM Plex Sans
 * Thai. Screens import `Text`/`TextInput` from here instead of 'react-native', so every
 * existing `fontWeight` keeps meaning what it did: the weight is translated into the
 * matching font file (Android can't synthesise bold for a custom family, so passing
 * fontWeight alongside a custom fontFamily renders the wrong weight there).
 *
 * An explicit `fontFamily` in the style (e.g. a monospace code) is left untouched.
 * Until App.tsx reports the fonts loaded — or if loading failed — nothing is changed
 * and the system font is used, so a font problem can never blank out text.
 */

let fontsReady = false;
export function setFontsReady(ready: boolean) {
  fontsReady = ready;
}

function familyForWeight(weight: TextStyle['fontWeight']): string {
  switch (String(weight ?? '400')) {
    case '500':
      return fonts.medium;
    case '600':
      return fonts.semibold;
    case '700':
    case '800':
    case '900':
    case 'bold':
      return fonts.bold;
    default:
      return fonts.regular;
  }
}

function withAppFont(style: TextProps['style']): TextProps['style'] {
  if (!fontsReady) return style;
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  // fontWeight reset to normal: the weight now lives in the font file itself.
  return [style, { fontFamily: familyForWeight(flat.fontWeight), fontWeight: 'normal' }];
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  return <RNText ref={ref} style={withAppFont(style)} {...rest} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  return <RNTextInput ref={ref} style={withAppFont(style) as TextInputProps['style']} {...rest} />;
});
