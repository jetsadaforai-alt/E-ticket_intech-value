import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { AppMode } from '../storage/appMode';
import { colors, radius, spacing } from '../theme';

type Props = {
  visible: boolean;
  target: AppMode;
};

const CONTENT: Record<AppMode, { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }> = {
  vendor: { icon: 'storefront-outline', label: 'ร้านค้า' },
  staff: { icon: 'scan-outline', label: 'staff' },
  customer: { icon: 'home-outline', label: 'ลูกค้า' },
};

// Purely a cosmetic pause matching the Figma "please wait" moment (Figma 352:4302) — setMode()
// in ModeContext is synchronous, there's no real async setup happening underneath this.
export function SwitchingModeOverlay({ visible, target }: Props) {
  const { icon, label } = CONTENT[target];
  return (
    <Modal visible={visible} transparent animationType="fade">
      <LinearGradient
        colors={[colors.primary, '#4F6BFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backdrop}
      >
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={40} color="#fff" />
        </View>
        <Text style={styles.title}>กำลังสลับเข้าสู่โหมด{label}...</Text>
        <Text style={styles.subtitle}>กรุณารอสักครู่...</Text>
        <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  iconBox: {
    width: 96, height: 96, borderRadius: radius.card,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: spacing.xs },
  spinner: { marginTop: spacing.xl },
});
