import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IBMPlexSansThai_400Regular } from '@expo-google-fonts/ibm-plex-sans-thai/400Regular';
import { IBMPlexSansThai_500Medium } from '@expo-google-fonts/ibm-plex-sans-thai/500Medium';
import { IBMPlexSansThai_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-thai/600SemiBold';
import { IBMPlexSansThai_700Bold } from '@expo-google-fonts/ibm-plex-sans-thai/700Bold';
import { AuthProvider } from './src/context/AuthContext';
import { ModeProvider } from './src/context/ModeContext';
import { ToastProvider } from './src/components/Toast';
import { AppBootScreen } from './src/components/AppBootScreen';
import { setFontsReady } from './src/components/AppText';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  // Only the four weights the type scale uses (theme.ts `fonts`) — importing the
  // package root would bundle all seven.
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansThai_400Regular,
    IBMPlexSansThai_500Medium,
    IBMPlexSansThai_600SemiBold,
    IBMPlexSansThai_700Bold,
  });

  // A font that fails to load must not block the app — AppText falls back to the
  // system font when fontsReady stays false.
  if (!fontsLoaded && !fontError) return <AppBootScreen />;
  setFontsReady(fontsLoaded);

  return (
    // จำเป็นสำหรับ useSafeAreaInsets() — ตั้งแต่ Expo SDK 53 Android เป็น edge-to-edge โดย
    // ค่าเริ่มต้น ความสูงคีย์บอร์ด (IME inset) รายงานผ่าน insets.bottom ของ hook นี้เท่านั้น
    // (react-native-safe-area-context 5.x ขึ้นไป) ไม่ใช่ผ่าน Keyboard event แบบเดิมอีกต่อไป —
    // ดู ChatRoomScreen.tsx ที่ใช้จริง
    <SafeAreaProvider>
      <AuthProvider>
        <ModeProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
          {/* พื้นหลังของทุกหน้าจอเป็นสีอ่อน (colors.background) เสมอ ไม่มีโหมดมืดจริง —
              "auto" จะอิงธีมของเครื่อง ถ้าเครื่องอยู่โหมดมืดจะได้ไอคอนสีขาวซึ่งกลืนกับพื้นแอปที่ยัง
              สว่างอยู่เหมือนเดิม ใช้ dark-content ตายตัวแทนให้ตรงกับพื้นแอปจริงเสมอ */}
          <StatusBar style="dark" />
        </ModeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
