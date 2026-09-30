import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ScreenCapture from 'expo-screen-capture';

const TAG = 'ticket-qr';

/**
 * While a scannable QR is on screen (and the screen is focused):
 * - screen brightness to max, restored to what it was on leave
 * - screen kept awake, so it doesn't dim while staff line up the scanner
 * - screenshots/recording blocked — release builds only, so screenshots for the
 *   report can still be taken from Expo Go (dev). Android blocks both; iOS only hides
 *   screen recording.
 *
 * Every call is best-effort: a device that refuses any of these just keeps working
 * as before.
 */
export function useQrScreenMode(active: boolean) {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      let previousBrightness: number | null = null;
      let cancelled = false;

      (async () => {
        try {
          previousBrightness = await Brightness.getBrightnessAsync();
          if (!cancelled) await Brightness.setBrightnessAsync(1);
        } catch {
          // brightness control unavailable — ignore
        }
      })();
      activateKeepAwakeAsync(TAG).catch(() => {});
      if (!__DEV__) ScreenCapture.preventScreenCaptureAsync(TAG).catch(() => {});

      return () => {
        cancelled = true;
        (async () => {
          try {
            if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
            else if (previousBrightness !== null) await Brightness.setBrightnessAsync(previousBrightness);
          } catch {
            // ignore
          }
        })();
        deactivateKeepAwake(TAG).catch(() => {});
        if (!__DEV__) ScreenCapture.allowScreenCaptureAsync(TAG).catch(() => {});
      };
    }, [active])
  );
}
