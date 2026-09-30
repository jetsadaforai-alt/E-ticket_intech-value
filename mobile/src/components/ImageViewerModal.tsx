import React from 'react';
import { Modal, View, Image, Pressable, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';

type Props = {
  /** Already resolved to an absolute URL. Null closes the viewer. */
  uri: string | null;
  onClose: () => void;
  caption?: string | null;
};

/**
 * Full-screen look at one image. Tapping anywhere closes it, which is what people try
 * first; the explicit ✕ is there for anyone who doesn't.
 */
export function ImageViewerModal({ uri, onClose, caption }: Props) {
  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>

        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : null}

        {caption ? (
          <View style={styles.captionBox}>
            <Text style={styles.caption}>{caption}</Text>
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  closeButton: { position: 'absolute', top: 48, right: spacing.lg, zIndex: 1 },
  image: { width: '100%', height: '70%' },
  captionBox: {
    position: 'absolute',
    bottom: 56,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  caption: { fontSize: 14, color: colors.text, textAlign: 'center' },
});
