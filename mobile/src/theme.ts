// Figma redesign 2026-08-16 ,
// refined 2026-09-27 toward the Stitch mockups' look (layered surfaces, status colours).
// Font: IBM Plex Sans Thai, loaded in App.tsx and applied app-wide by components/AppText.
export const colors = {
  primary: '#00685F',       // เขียวเข้มหลักของแบรนด์ (ใหม่)
  primaryDark: '#00453F',
  primarySoft: '#E6F1EF',   // พื้นอ่อนสำหรับ chip / ไอคอนวงกลม
  primaryPill: '#CAEAD6',   // พื้น pill ของ tab ที่ active / ป้ายสถานะ "เหลืออีก N สิทธิ์"
  primaryPillText: '#4E6B5A',

  danger: '#BA1A1A',
  dangerBg: '#FDECEC',
  success: '#1a7f37',
  warning: '#9a6700',
  warningBg: '#fff8c5',

  // ส้มอมแดงอุ่นๆ สำหรับป้ายส่วนลด/ของมันต้องมี — แยกจาก danger (แดงเตือน) ตั้งใจ เพราะป้าย
  // ส่วนลดควรรู้สึกน่าดึงดูด/เชิญชวน ไม่ใช่สัญญาณเตือน (ดีไซน์พาส 2026-08-22 "น่ากดน่าใช้")
  dealAccent: '#FF6B4A',
  dealAccentDark: '#E5502D',

  background: '#F8F9FA',
  surface: '#fff',
  border: '#E1E3E4',
  borderStrong: '#BCC9C6',
  text: '#191C1D',
  textMuted: '#3D4947',

  neutralBubble: '#EDEEEF', // ไอคอนวงกลมสีเทากลาง ใช้ในรายการ Settings (ต่างจาก primarySoft ที่ใช้ไล่โทนเขียว)

  // ผิวหลายระดับแบบ Stitch — ใช้แยกพื้นที่ (แถบแท็บ, กล่องข้อมูล) โดยไม่ต้องพึ่งเส้นขอบ
  surfaceLow: '#F2F4F3',
  surfaceHigh: '#E7E9E8',
  onPrimary: '#FFFFFF',

  // สีสถานะตั๋ว — ใช้ทั้ง badge และแท็บ Wallet ให้สามสถานะแยกกันออกด้วยสี ไม่ใช่แค่ข้อความ
  statusActiveBg: '#CAEAD6',
  statusActiveText: '#0B5134',
  statusUsedBg: '#E3E6E5',
  statusUsedText: '#3D4947',
  statusExpiredBg: '#FDECEC',
  statusExpiredText: '#93000A',
  statusPendingBg: '#FFF1C2',
  statusPendingText: '#6B4E00',
};

export type Palette = typeof colors;

/**
 * โหมดร้านค้าใช้โทนน้ำเงิน ไม่ใช่เขียว — ใน Figma ทั้ง section "vandor" (27 จอ) เป็นน้ำเงินหมด
 * ส่วน section "user" กับ "staff" เป็นเขียว และหน้า "สมัครเป็นผู้ขาย" ก็เป็นเขียวด้วยทั้งที่เป็น
 * เรื่องร้านค้า เพราะตอนสมัครผู้ใช้ยังอยู่ในโหมดลูกค้า — การแยกสีจึงผูกกับ "โหมดที่กำลังใช้อยู่"
 * ไม่ใช่ "หัวข้อของหน้า"
 *
 * ค่าที่ใช้ sample มาจาก Figma จริง: ปุ่ม/พื้นทึบ #004ECB, accent สว่าง #0064FF, พื้นอ่อน #D3E4FE
 * เฉพาะโทนแบรนด์เท่านั้นที่ต่าง — background/text/border/danger ใช้ร่วมกันทั้งสองโหมด
 */
export const vendorColors: Palette = {
  ...colors,
  primary: '#004ECB',
  primaryDark: '#0537B0',
  primarySoft: '#E4EDFD',
  primaryPill: '#D3E4FE',
  primaryPillText: '#3A5687',
};

/** accent สว่างที่ Figma ใช้กับ gradient/ไฮไลต์ในโหมดร้าน (ไม่ใช่สีปุ่ม) */
export const vendorAccent = '#0064FF';

export const paletteFor = (mode: string): Palette => (mode === 'vendor' ? vendorColors : colors);

export const spacing = { xs: 4, sm: 8, md: 16, lg: 20, xl: 40 };

export const radius = { sm: 8, md: 12, lg: 20, card: 24, badge: 4, pill: 999 };

/** ขนาดพื้นที่กดขั้นต่ำ (WCAG / Apple HIG 44pt) — ใช้กับปุ่มไอคอน, chip, ลิงก์ข้อความ */
export const touch = { min: 44 };

/**
 * IBM Plex Sans Thai — แยกไฟล์ตามน้ำหนัก เพราะ Android ไม่สังเคราะห์ตัวหนาให้ฟอนต์ custom
 * ได้ถูกต้อง ชื่อต้องตรงกับ key ที่ส่งเข้า useFonts ใน App.tsx
 */
export const fonts = {
  regular: 'IBMPlexSansThai_400Regular',
  medium: 'IBMPlexSansThai_500Medium',
  semibold: 'IBMPlexSansThai_600SemiBold',
  bold: 'IBMPlexSansThai_700Bold',
};

/**
 * ระดับตัวอักษร — lineHeight ≈ 1.5 เท่าของขนาด เผื่อสระบน (ิ ี ึ ื ั ่ ้) และสระล่าง (ุ ู) ของ
 * ภาษาไทยไม่ให้ชนบรรทัดข้างเคียง ขนาดเล็กสุด 12 สำหรับอ่านบนมือถือ
 * ใช้แบบ spread: `{ ...type.body, color: colors.text }`
 *
 * ระบุเป็น fontWeight ไม่ใช่ fontFamily ตั้งใจ — components/AppText แปลงน้ำหนักเป็นไฟล์ฟอนต์
 * ให้เอง และถ้าฟอนต์โหลดไม่สำเร็จจะตกไปใช้ฟอนต์ระบบได้โดยไม่ error
 */
export const type = {
  display: { fontWeight: '700', fontSize: 28, lineHeight: 40 },
  title: { fontWeight: '700', fontSize: 22, lineHeight: 32 },
  heading: { fontWeight: '600', fontSize: 18, lineHeight: 28 },
  subheading: { fontWeight: '600', fontSize: 16, lineHeight: 24 },
  body: { fontWeight: '400', fontSize: 15, lineHeight: 24 },
  bodyStrong: { fontWeight: '600', fontSize: 15, lineHeight: 24 },
  bodySmall: { fontWeight: '400', fontSize: 13, lineHeight: 20 },
  label: { fontWeight: '600', fontSize: 13, lineHeight: 20 },
  button: { fontWeight: '600', fontSize: 16, lineHeight: 24 },
  caption: { fontWeight: '400', fontSize: 12, lineHeight: 18 },
  captionStrong: { fontWeight: '600', fontSize: 12, lineHeight: 18 },
} as const;

// Card shadow token (Figma: 0px 4px 20px rgba(0,0,0,0.04)) — spread across the RN/iOS
// shadow* props plus Android's single `elevation` knob, since there's no unified API.
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 3,
  },
};
