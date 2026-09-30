import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

/**
 * แสดงระหว่าง RootNavigator เช็ค login/mode ครั้งแรกตอนเปิดแอป (ก่อนรู้ว่าจะพาไปหน้าไหน) —
 * ใช้โลโก้ gradient แบบเดียวกับ LandingScreen เพื่อให้ยังเห็นแบรนด์ตั้งแต่วินาทีแรกที่เปิดแอป
 * แทนที่จะเจอ spinner เปล่าๆ แยกออกจาก LoadingView ตั้งใจ — LoadingView ยังใช้ตามปกติสำหรับ
 * loading state ระหว่างหน้า (เช่น "กำลังโหลด Event...") ซึ่งไม่ควรมีโลโก้ใหญ่แบบนี้
 */
export function AppBootScreen() {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.primary, colors.primaryDark]}
        start={{ x: 0.15, y: 0.1 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.logoBox}
      >
        <Ionicons name="ticket" size={44} color="#fff" />
      </LinearGradient>
      <Text style={styles.title}>E-ticket</Text>
      <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.md },
  logoBox: {
    width: 104, height: 104, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16,
    elevation: 8,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  spinner: { marginTop: spacing.sm },
});
