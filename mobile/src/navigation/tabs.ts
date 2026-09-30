import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { StackActionHelpers } from '@react-navigation/native';
// Type-only: a value import here would close a runtime cycle
// (RootNavigator → screens → BottomTabBar → tabs → RootNavigator).
import type { RootStackParamList } from './RootNavigator';
import type { AppMode } from '../context/ModeContext';

// Every per-screen NativeStackNavigationProp<RootStackParamList, X> intersects
// StackActionHelpers<RootStackParamList> unchanged — the halves that differ per
// route are `route`/`setParams`, not `replace`. So Pick-ing `replace` off it gives
// a type every screen's navigation prop satisfies, while keeping the params
// overload that the old hand-written `{ replace: (s: TabKey) => void }` threw away.
export type TabNavigation = Pick<StackActionHelpers<RootStackParamList>, 'replace'>;

export type TabKey = Extract<
  keyof RootStackParamList,
  | 'Home'
  | 'Wallet'
  | 'Profile'
  | 'ChatList'
  | 'ShopDashboard'
  | 'ShopEvents'
  | 'StaffManagement'
  | 'Scanner'
  | 'StaffToday'
>;

type IconName = ComponentProps<typeof Ionicons>['name'];

export type TabItem = {
  key: TabKey;
  label: string;
  icon: IconName;
  /** params are baked in at build time — see the note below */
  go: (nav: TabNavigation) => void;
};

/**
 * Tabs are thunks rather than `{ route, params }` data on purpose: calling
 * `nav.replace(t.route, t.params)` with a union-typed `route` makes TS distribute
 * the conditional in `replace`'s signature into a union of argument tuples it then
 * refuses to call. Baking the params into a per-tab arrow keeps every `replace()`
 * monomorphic — a string literal plus its own params — so it typechecks with no casts.
 */
export function tabsForMode(
  mode: AppMode,
  ids: { vendorShopId: string | null; staffShopId: string | null }
): TabItem[] {
  if (mode === 'vendor' && ids.vendorShopId) {
    const shopId = ids.vendorShopId;
    return [
      { key: 'ShopDashboard', label: 'แดชบอร์ด', icon: 'stats-chart-outline', go: (n) => n.replace('ShopDashboard', { shopId }) },
      { key: 'ShopEvents', label: 'Event', icon: 'pricetags-outline', go: (n) => n.replace('ShopEvents', { shopId }) },
      { key: 'ChatList', label: 'แชท', icon: 'chatbubble-ellipses-outline', go: (n) => n.replace('ChatList') },
      { key: 'StaffManagement', label: 'พนักงาน', icon: 'people-outline', go: (n) => n.replace('StaffManagement', { shopId }) },
      { key: 'Profile', label: 'โปรไฟล์', icon: 'person-outline', go: (n) => n.replace('Profile') },
    ];
  }

  if (mode === 'staff' && ids.staffShopId) {
    const shopId = ids.staffShopId;
    return [
      { key: 'Scanner', label: 'สแกน', icon: 'scan-outline', go: (n) => n.replace('Scanner') },
      { key: 'ShopEvents', label: 'Event', icon: 'pricetags-outline', go: (n) => n.replace('ShopEvents', { shopId }) },
      { key: 'ChatList', label: 'แชท', icon: 'chatbubble-ellipses-outline', go: (n) => n.replace('ChatList') },
      { key: 'Profile', label: 'โปรไฟล์', icon: 'person-outline', go: (n) => n.replace('Profile') },
    ];
  }

  // customer, and the defensive fallback when a privileged mode has no shopId yet
  return [
    { key: 'Home', label: 'หน้าแรก', icon: 'home-outline', go: (n) => n.replace('Home') },
    { key: 'Wallet', label: 'ตั๋วของฉัน', icon: 'ticket-outline', go: (n) => n.replace('Wallet') },
    { key: 'ChatList', label: 'แชท', icon: 'chatbubble-ellipses-outline', go: (n) => n.replace('ChatList') },
    { key: 'Profile', label: 'โปรไฟล์', icon: 'person-outline', go: (n) => n.replace('Profile') },
  ];
}
