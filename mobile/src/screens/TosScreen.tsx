import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import { colors, radius, shadows, spacing, type } from '../theme';

// หน้าอ่านอย่างเดียว — backend ของ mini ไม่มี field เก็บการยอมรับ ToS (ตัดออกตาม scope)
// จึงไม่ทำเป็นด่านบังคับกดยอมรับตอนสมัคร แต่ให้เปิดอ่านได้จากหน้าโปรไฟล์
const TOS_TEXT = `1. บัญชีผู้ใช้
บัญชีนี้ผูกกับเบอร์โทรศัพท์ที่ยืนยันผ่านรหัส OTP แล้ว ผู้ใช้มีหน้าที่รักษาความปลอดภัยของอุปกรณ์และรหัส OTP ของตนเอง ระบบถือว่าการกระทำใด ๆ ที่เกิดขึ้นหลังการยืนยัน OTP สำเร็จเป็นการกระทำของเจ้าของบัญชีนั้น

2. ตั๋วส่วนลด
ตั๋วส่วนลดที่ได้รับผ่านแอปนี้ใช้ได้ตามเงื่อนไขที่ร้านค้าแต่ละรายกำหนดเท่านั้น และมีระยะเวลาจำกัดตามที่ระบุไว้ในแต่ละ Event

ผู้ใช้มีสิทธิ์ถือตั๋วของ Event เดียวกันได้ 1 ใบเท่านั้น ไม่ว่าจะได้มาจากการลงทะเบียนเองหรือรับต่อจากผู้อื่น

3. การแชร์ตั๋ว
ตั๋วที่ยังไม่ถูกใช้สามารถแชร์ให้ผู้อื่นได้ เมื่อผู้รับกดรับตั๋วแล้ว สิทธิ์ในตั๋วใบนั้นจะโอนไปยังผู้รับทันที และผู้แชร์จะไม่สามารถเรียกคืนได้

4. การใช้สิทธิ์
การใช้สิทธิ์ส่วนลดต้องแสดง QR Code ในแอปให้พนักงานของร้านสแกน ณ จุดขายเท่านั้น QR Code จะเปลี่ยนรหัสอัตโนมัติทุก 45-60 วินาที เพื่อป้องกันการนำภาพหน้าจอไปใช้ซ้ำ

ตั๋วที่ถูกสแกนใช้สิทธิ์แล้วจะไม่สามารถนำกลับมาใช้ได้อีก

5. ข้อมูลส่วนบุคคล
ระบบเก็บเบอร์โทรศัพท์ ชื่อที่แสดง และอีเมล (หากผู้ใช้กรอก) เพื่อใช้ยืนยันตัวตนและติดต่อเกี่ยวกับการใช้งานแอปนี้เท่านั้น ไม่มีการเปิดเผยข้อมูลดังกล่าวต่อบุคคลที่สามนอกเหนือจากร้านค้าที่ผู้ใช้ไปใช้สิทธิ์

6. การยกเลิก Event โดยร้านค้า
ร้านค้ามีสิทธิ์ยกเลิก Event ได้ ในกรณีดังกล่าวตั๋วที่ยังไม่มีผู้รับจะถูกยกเลิก แต่ตั๋วที่ผู้ใช้รับไปแล้วหรือใช้สิทธิ์ไปแล้วจะไม่ได้รับผลกระทบ

7. การติดต่อ
หากพบปัญหาการใช้งาน สามารถแจ้งเรื่องผ่านระบบ Support ในแอป ทีมงานจะติดต่อกลับตามลำดับคำขอ`;

export default function TosScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>ข้อกำหนดการใช้งานและนโยบายความเป็นส่วนตัว</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{TOS_TEXT}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  title: { ...type.title, color: colors.text },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card,
    padding: spacing.lg, ...shadows.card,
  },
  body: { ...type.body, color: colors.text },
});
