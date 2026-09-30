import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './AppText';
import { colors, radius, spacing, type } from '../theme';

type Tone = 'success' | 'info' | 'error';
type ToastState = { id: number; message: string; tone: Tone } | null;
type ShowToast = (message: string, tone?: Tone) => void;

const ToastContext = createContext<ShowToast>(() => {});

/**
 * Non-blocking confirmation ("แชร์แล้ว", "บันทึกแล้ว") — the app previously used
 * Alert.alert for success, which stops the user and needs a tap to dismiss. Errors that
 * need a decision still use the screen's own banner/Alert; this is for "it worked".
 */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const DURATION_MS = 2600;
const ICON: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  info: 'information-circle',
  error: 'alert-circle',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback<ShowToast>((message, tone = 'success') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, DURATION_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [toast, opacity]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.wrap, { bottom: insets.bottom + 88, opacity }]}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <View style={styles.toast}>
            <Ionicons
              name={ICON[toast.tone]}
              size={20}
              color={toast.tone === 'error' ? '#FFB4AB' : toast.tone === 'success' ? '#8FE3B0' : '#FFFFFF'}
            />
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.md, right: spacing.md, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    maxWidth: 480,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  text: { ...type.bodySmall, color: '#FFFFFF', flexShrink: 1 },
});
