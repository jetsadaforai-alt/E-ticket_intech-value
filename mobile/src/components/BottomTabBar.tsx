import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './AppText';
import { useMode } from '../context/ModeContext';
import { useUnreadChat } from '../hooks/useUnreadChat';
import { tabsForMode, type TabKey, type TabNavigation } from '../navigation/tabs';
import { colors, radius, spacing, touch, type } from '../theme';
import { useColors } from '../hooks/useColors';

// Simple stack-based "tab bar" — navigation.replace() between the main screens
// instead of a nested Tab Navigator, so every screen can stay typed against the
// same flat RootStackParamList rather than composing Stack + Tab prop types.
// Which tabs appear is driven entirely by the current app mode (see navigation/tabs.ts).
//
// UI refresh 2026-09-27: each tab is a full-height touch target (≥56px), labels 12px
// (was 11), unread badge 11px (was 9) — vendor mode's 5 tabs still fit a 360pt screen.
export default function BottomTabBar({
  active,
  navigation,
}: {
  active: TabKey;
  navigation: TabNavigation;
}) {
  const { mode, vendorShopId, staffShopId } = useMode();
  // The active-tab pill is the one piece of brand colour visible in every mode,
  // so it has to follow the mode rather than the static teal palette.
  const c = useColors();
  const { unreadCount } = useUnreadChat();
  const tabs = useMemo(
    () => tabsForMode(mode, { vendorShopId, staffShopId }),
    [mode, vendorShopId, staffShopId]
  );
  // On devices with a gesture pill or 3-button nav bar that isn't reserved by the OS
  // (varies by manufacturer/Android version), the fixed paddingBottom below wasn't
  // enough and the bar sat under the system nav buttons. insets.bottom is 0 on
  // devices that already reserve the space, so this only adds extra room where needed.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: spacing.xs + insets.bottom }]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const showBadge = tab.key === 'ChatList' && unreadCount > 0;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={showBadge ? `${tab.label} มีข้อความใหม่ ${unreadCount}` : tab.label}
            onPress={() => {
              if (!isActive) tab.go(navigation);
            }}
          >
            <View style={[styles.iconWrap, isActive && { backgroundColor: c.primaryPill }]}>
              <Ionicons name={tab.icon} size={22} color={isActive ? c.primary : colors.textMuted} />
              {showBadge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </View>
            <Text
              style={[styles.label, isActive && { color: c.primary, fontWeight: '700' }]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 6,
    // paddingBottom set inline above (spacing.xs + safe-area inset)
  },
  tab: { flex: 1, minHeight: touch.min + 12, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconWrap: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  label: { ...type.caption, color: colors.textMuted },
  badge: {
    position: 'absolute',
    top: -3,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, lineHeight: 14, fontWeight: '700' },
});
