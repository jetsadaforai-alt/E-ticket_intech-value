import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from './PrimaryButton';
import { colors, radius, shadows, spacing } from '../theme';

type Props = {
  visible: boolean;
  // Omit for a plain title/subtitle confirm (no icon circle) — e.g. "ท่านต้องการรับ
  // คูปองหรือไม่". Pass one for a celebratory result like ClaimSuccessModal's checkmark.
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
};

/** Shared shell (backdrop/card/glow) behind every custom confirm dialog in the claim
 * flow — generalized from what was originally just ClaimSuccessModal, so the
 * login-required, confirm-claim, and success-choice dialogs all get the same look
 * without three near-identical components. */
export function ConfirmModal({ visible, icon, title, subtitle, primaryLabel, onPrimary, secondaryLabel, onSecondary }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {icon ? (
            <View style={styles.glow}>
              <View style={styles.iconCircle}>
                <Ionicons name={icon} size={48} color="#fff" />
              </View>
            </View>
          ) : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <PrimaryButton title={primaryLabel} onPress={onPrimary} style={styles.fullWidthBtn} />
          <PrimaryButton title={secondaryLabel} variant="secondary" onPress={onSecondary} style={styles.fullWidthBtn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(25,28,29,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  glow: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.primaryPill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  fullWidthBtn: { width: '100%' },
});
