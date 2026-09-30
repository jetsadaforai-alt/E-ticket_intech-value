import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { AppBootScreen } from '../components/AppBootScreen';
import { useMode } from '../context/ModeContext';
import { paletteFor } from '../theme';
import type { PaymentIntent } from '../api/quota';

import LandingScreen from '../screens/LandingScreen';
import AuthChoiceScreen from '../screens/AuthChoiceScreen';
import RegisterScreen from '../screens/RegisterScreen';
import LoginScreen from '../screens/LoginScreen';
import OtpScreen from '../screens/OtpScreen';
import HomeScreen from '../screens/HomeScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import WalletScreen from '../screens/WalletScreen';
import TicketDetailScreen from '../screens/TicketDetailScreen';
import ClaimTicketScreen from '../screens/ClaimTicketScreen';
import ShareHistoryScreen from '../screens/ShareHistoryScreen';
import ScannerScreen from '../screens/ScannerScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AccountSuspendedScreen from '../screens/AccountSuspendedScreen';
import VendorSignupScreen from '../screens/VendorSignupScreen';
import ShopSetupScreen from '../screens/ShopSetupScreen';
import ShopDashboardScreen from '../screens/ShopDashboardScreen';
import ShopEventsScreen from '../screens/ShopEventsScreen';
import ShopEventViewScreen from '../screens/ShopEventViewScreen';
import EventCompareScreen from '../screens/EventCompareScreen';
import StaffTodayScreen from '../screens/StaffTodayScreen';
import EventFormScreen from '../screens/EventFormScreen';
import StaffManagementScreen from '../screens/StaffManagementScreen';
import ShopProductsScreen from '../screens/ShopProductsScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import NotificationCenterScreen from '../screens/NotificationCenterScreen';
import TosScreen from '../screens/TosScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatRoomScreen from '../screens/ChatRoomScreen';
import SupportListScreen from '../screens/SupportListScreen';
import SupportThreadScreen from '../screens/SupportThreadScreen';
import PackageScreen from '../screens/PackageScreen';
import TopupScreen from '../screens/TopupScreen';
import ConfirmPurchaseScreen from '../screens/ConfirmPurchaseScreen';
import PaymentScreen from '../screens/PaymentScreen';
import PurchaseHistoryScreen from '../screens/PurchaseHistoryScreen';

// A guarded action a guest triggered before being forced through Login/Register/Otp.
// Threaded through Login -> Otp and Register -> Otp as an optional route param; OtpScreen
// consumes it exactly once, right after loginWithToken succeeds, instead of unconditionally
// resetting to Home — see OtpScreen.tsx. Scoped to the guarded actions that actually exist
// today (event register, contact-shop chat, chat-list login prompt); add a union member
// here if a future guarded action needs it rather than generalizing to an arbitrary
// screen/params shape.
export type PendingAction =
  | { kind: 'register_event'; eventId: string }
  | { kind: 'contact_shop'; eventId: string; shopId: string }
  | { kind: 'return_to'; screen: 'ChatList' };

export type RootStackParamList = {
  Landing: undefined;
  AuthChoice: { returnTo?: PendingAction } | undefined;
  Register: { returnTo?: PendingAction } | undefined;
  Login: { returnTo?: PendingAction } | undefined;
  // devCode is only present in non-production responses (SMS provider is a stub there).
  // purpose: which screen started the OTP — the backend requires it on both OTP calls
  // ('login' never creates an account; 'register' refuses an existing one).
  Otp: { phone: string; purpose: 'login' | 'register'; devCode?: string; name?: string; email?: string; returnTo?: PendingAction };
  Home: undefined;
  // prefillRating: set only when arriving from TicketDetailScreen's post-redeem quick-rate
  // popup — seeds the review form's grade selector so the user only has to add a comment.
  EventDetail: { eventId: string; prefillRating?: number };
  Wallet: undefined;
  TicketDetail: { ticketId: string };
  ClaimTicket: undefined;
  ShareHistory: undefined;
  // eventId/eventTitle are display context only — POST /v1/staff/scan resolves the
  // event from the ticket itself and has no event filter, so the screen compares
  // the scanned ticket against this locally and warns on a mismatch.
  Scanner: { eventId?: string; eventTitle?: string } | undefined;
  Profile: undefined;
  AccountSuspended: undefined;
  VendorSignup: undefined;
  // No shopId = first-time setup (POST, right after vendor approval). A shopId = editing
  // the existing shop's name/address (PATCH).
  ShopSetup: { shopId?: string };
  ShopDashboard: { shopId: string };
  ShopEvents: { shopId: string };
  ShopEventView: { eventId: string };
  StaffToday: undefined;
  // Create and edit are the same screen/form — no eventId means create-under-shopId,
  // an eventId means edit that event (shopId is still passed so the product picker has
  // it immediately instead of waiting on the event to load). cloneFromEventId is a third
  // mode: relaunching an ended event — stays in "create" shape (new start/end/qty required)
  // but pre-fills every other field from the source event.
  EventForm: { shopId: string; eventId?: string; cloneFromEventId?: string };
  StaffManagement: { shopId: string };
  ShopProducts: { shopId: string };
  EventCompare: { shopId: string };
  EditProfile: undefined;
  NotificationCenter: undefined;
  Tos: undefined;
  ChatList: undefined;
  ChatRoom: { conversationId: string; title?: string };
  SupportList: undefined;
  SupportThread: { ticketId: string };
  Packages: undefined;
  // eventId is set only when topping up tickets for one particular event, which is
  // what raises that event's own ceiling rather than just the shared pool.
  Topup: { eventId?: string; eventTitle?: string } | undefined;
  // Sits between "tap to buy" and the real charge — createPurchase() only runs after
  // this screen's Confirm, so Cancel here never creates a Purchase/Payment row.
  ConfirmPurchase: {
    request:
      | { type: 'package'; package_id: string }
      | { type: 'event_topup' | 'ticket_topup'; quantity: number; target_event_id?: string };
    title: string;
    priceBaht: number;
    resultSummary: string;
    quotaPreview: {
      ticketDelta: number;
      eventDelta: number;
      newTicketPerEvent?: number;
      targetEventTitle?: string;
    };
  };
  // The payment intent is passed along rather than refetched: it is what the checkout
  // call just returned, and the screen polls the purchase for the authoritative status.
  Payment: { purchaseId: string; payment: PaymentIntent; summary: string };
  PurchaseHistory: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isLoading, me } = useAuth();
  const { isModeReady, mode, vendorShopId, staffShopId } = useMode();

  // Must wait for the stored mode too — initialRouteName/initialParams are read
  // only on the navigator's first render, so rendering before the mode is known
  // would permanently land a returning vendor on the customer home screen.
  if (isLoading || !isModeReady) {
    return <AppBootScreen />;
  }

  // A suspended account gets a completely separate, smaller stack rather than just a
  // different initialRouteName — every other endpoint already answers 403
  // ACCOUNT_SUSPENDED (middleware/auth.js), so letting navigation reach any of the
  // normal screens would just be a UI that looks alive but fails on every request.
  // ModeContext already calls refreshMe() on every foreground transition, so an account
  // suspended while the app sits open lands here automatically, no extra wiring needed.
  if (me?.status === 'suspended') {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerBackTitle: 'กลับ' }}>
          <Stack.Screen name="AccountSuspended" component={AccountSuspendedScreen} options={{ headerShown: false }} />
          <Stack.Screen name="SupportList" component={SupportListScreen} options={{ title: 'ช่วยเหลือและแจ้งปัญหา' }} />
          <Stack.Screen name="SupportThread" component={SupportThreadScreen} options={{ title: 'รายละเอียดเรื่องที่แจ้ง' }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  const headerPalette = paletteFor(mode);

  // Guest cold start goes straight to Home (browse-first, ตาม pattern Grab/foodpanda) แทนที่
  // จะบังคับเจอ Landing ก่อนเสมอ — Home/EventDetail รองรับ guest อยู่แล้ว (auth: false),
  // ตัวปุ่มที่ต้อง login (รับส่วนลด ฯลฯ) redirect ไป Login เองอยู่แล้วตอนกดจริง Landing ยังอยู่
  // ในระบบเหมือนเดิม แค่เข้าถึงผ่านปุ่ม "เข้าสู่ระบบ" บน Home แทนที่จะเป็นจุดเริ่มต้นบังคับ
  const initialRouteName =
    mode === 'vendor' && vendorShopId ? 'ShopDashboard' : mode === 'staff' && staffShopId ? 'Scanner' : 'Home';

  // All screens stay registered regardless of auth state — Home/EventDetail are
  // guest-accessible anyway, and conditionally registering Login/Otp only while
  // logged out creates a race with navigation.replace() right after the login
  // state flips (the navigator's screen list and the replace() call can land in
  // the wrong order since the state update is async relative to the next line).
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRouteName}
        // Header tint follows the mode too — otherwise vendor screens read blue
        // while their own title bar stays teal.
        screenOptions={{
          headerBackTitle: 'กลับ',
          headerTitleStyle: { color: headerPalette.primary, fontWeight: '800' },
          headerTintColor: headerPalette.primary,
        }}
      >
        <Stack.Screen name="Landing" component={LandingScreen} options={{ headerShown: false }} />
        <Stack.Screen name="AuthChoice" component={AuthChoiceScreen} options={{ title: '' }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'สมัครสมาชิก' }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Otp" component={OtpScreen} options={{ title: 'ยืนยัน OTP' }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'E-ticket' }} />
        <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ title: '' }} />
        <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: 'ตั๋วของฉัน' }} />
        <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: 'ตั๋ว' }} />
        <Stack.Screen name="ClaimTicket" component={ClaimTicketScreen} options={{ title: 'รับตั๋วที่แชร์มา' }} />
        <Stack.Screen name="ShareHistory" component={ShareHistoryScreen} options={{ title: 'ประวัติการแชร์ตั๋ว' }} />
        <Stack.Screen name="Scanner" component={ScannerScreen} options={{ title: 'สแกน QR', headerShown: false }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'โปรไฟล์' }} />
        <Stack.Screen name="VendorSignup" component={VendorSignupScreen} options={{ title: 'สมัครเป็นเจ้าของร้าน' }} />
        <Stack.Screen name="ShopSetup" component={ShopSetupScreen} options={{ title: 'ตั้งค่าร้าน' }} />
        {/* initialParams so a cold start straight into vendor/staff mode still has a
            shopId — the tab bar supplies it on every later navigation. */}
        <Stack.Screen
          name="ShopDashboard"
          component={ShopDashboardScreen}
          options={{ title: 'แดชบอร์ดร้าน' }}
          initialParams={vendorShopId ? { shopId: vendorShopId } : undefined}
        />
        <Stack.Screen
          name="ShopEvents"
          component={ShopEventsScreen}
          options={{ title: 'Event ของร้าน' }}
          initialParams={vendorShopId ?? staffShopId ? { shopId: (vendorShopId ?? staffShopId)! } : undefined}
        />
        <Stack.Screen name="ShopEventView" component={ShopEventViewScreen} options={{ title: 'รายละเอียด Event' }} />
        <Stack.Screen name="EventCompare" component={EventCompareScreen} options={{ title: 'เปรียบเทียบ Event' }} />
        <Stack.Screen name="StaffToday" component={StaffTodayScreen} options={{ title: 'สรุปวันนี้' }} />
        <Stack.Screen
          name="EventForm"
          component={EventFormScreen}
          options={({ route }) => ({ title: route.params.eventId ? 'จัดการ Event' : 'สร้าง Event' })}
        />
        <Stack.Screen
          name="StaffManagement"
          component={StaffManagementScreen}
          options={{ title: 'จัดการพนักงาน' }}
          initialParams={vendorShopId ? { shopId: vendorShopId } : undefined}
        />
        <Stack.Screen
          name="ShopProducts"
          component={ShopProductsScreen}
          options={{ title: 'สินค้าของร้าน' }}
          initialParams={vendorShopId ? { shopId: vendorShopId } : undefined}
        />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'แก้ไขโปรไฟล์' }} />
        <Stack.Screen name="NotificationCenter" component={NotificationCenterScreen} options={{ title: 'การแจ้งเตือน' }} />
        <Stack.Screen name="Tos" component={TosScreen} options={{ title: 'ข้อกำหนดการใช้งาน' }} />
        <Stack.Screen name="ChatList" component={ChatListScreen} options={{ title: 'แชท' }} />
        <Stack.Screen name="ChatRoom" component={ChatRoomScreen} options={{ title: 'แชท' }} />
        <Stack.Screen name="SupportList" component={SupportListScreen} options={{ title: 'ช่วยเหลือและแจ้งปัญหา' }} />
        <Stack.Screen name="SupportThread" component={SupportThreadScreen} options={{ title: 'รายละเอียดเรื่องที่แจ้ง' }} />
        <Stack.Screen name="Packages" component={PackageScreen} options={{ title: 'แพ็กเกจโควตา' }} />
        <Stack.Screen name="Topup" component={TopupScreen} options={{ title: 'ซื้อโควตาเพิ่ม' }} />
        <Stack.Screen name="ConfirmPurchase" component={ConfirmPurchaseScreen} options={{ title: 'ยืนยันการสั่งซื้อ' }} />
        <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'ชำระเงิน' }} />
        <Stack.Screen name="PurchaseHistory" component={PurchaseHistoryScreen} options={{ title: 'ประวัติการซื้อ' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
