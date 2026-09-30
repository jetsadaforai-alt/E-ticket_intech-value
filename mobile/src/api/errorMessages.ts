import { ApiError } from './client';

/**
 * Every backend error code a customer can run into, in plain Thai. Screens used to each
 * keep their own small map (or show the raw code — e.g. a review failing with
 * "NOT_ELIGIBLE"); this is the one place to look now. Wording from the old per-screen
 * maps is kept as-is so nothing a user already knew changes.
 *
 * Only the text is decided here — which codes the backend sends, and when, is untouched.
 */
const MESSAGES: Record<string, string> = {
  // เข้าสู่ระบบ / OTP
  COOLDOWN_ACTIVE: 'ขอรหัสถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  LOCKED_OUT: 'ลองผิดเกินกำหนด กรุณารอสักครู่',
  INVALID_CODE: 'รหัส OTP ไม่ถูกต้อง',
  OTP_EXPIRED_OR_NOT_REQUESTED: 'รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่',
  INVALID_PHONE: 'เบอร์โทรไม่ถูกต้อง ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0',
  INVALID_EMAIL: 'รูปแบบอีเมลไม่ถูกต้อง',
  ACCOUNT_SUSPENDED: 'บัญชีนี้ถูกระงับการใช้งาน',
  NOT_REGISTERED: 'เบอร์นี้ยังไม่ได้สมัครสมาชิก กรุณาสมัครสมาชิกก่อน',
  ALREADY_REGISTERED: 'เบอร์นี้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบ',

  // รับตั๋ว
  ALREADY_HAS_TICKET: 'คุณมีตั๋วของ Event นี้อยู่แล้ว',
  SOLD_OUT: 'ตั๋วหมดแล้ว',
  EVENT_ENDED: 'Event นี้หมดเวลาแล้ว',
  EVENT_NOT_AVAILABLE: 'Event นี้ไม่เปิดให้ลงทะเบียนแล้ว',

  // QR / ตั๋ว
  QR_EXPIRED: 'QR หมดอายุแล้ว กำลังสร้างรหัสใหม่',
  TICKET_NOT_REDEEMABLE: 'ตั๋วใบนี้ใช้ไปแล้วหรือถูกยกเลิก',
  TICKET_NOT_FOUND: 'ไม่พบตั๋วใบนี้',
  TICKET_NOT_SHAREABLE: 'ตั๋วใบนี้แชร์ไม่ได้แล้ว (อาจถูกใช้ไปแล้ว)',

  // แชร์ / รับตั๋วที่แชร์
  INVALID_LINK: 'รหัสไม่ถูกต้อง',
  ALREADY_CLAIMED: 'ตั๋วนี้ถูกรับไปแล้ว',
  LINK_EXPIRED: 'ลิงก์หมดอายุแล้ว (ลิงก์ใช้ได้ 24 ชั่วโมง) ขอให้เพื่อนแชร์ใหม่',
  CANNOT_CLAIM_OWN_SHARE: 'รับตั๋วที่คุณแชร์เองไม่ได้',

  // รีวิว
  NOT_ELIGIBLE: 'รีวิวได้หลังจากใช้สิทธิ์ของ Event นี้แล้วเท่านั้น',
  INVALID_RATING: 'กรุณาให้คะแนนก่อนส่งรีวิว',
  INVALID_COMMENT: 'ความเห็นไม่ถูกต้อง',
  COMMENT_TOO_LONG: 'ความเห็นยาวเกินไป (ไม่เกิน 500 ตัวอักษร)',
  NO_REVIEW: 'ต้องส่งรีวิวก่อนถึงจะแนบรูปได้',

  // อัปโหลดไฟล์
  NO_FILE: 'ยังไม่ได้เลือกไฟล์',
  INVALID_FILE_TYPE: 'ไฟล์ไม่รองรับ ใช้รูป JPG/PNG (หรือ PDF สำหรับเอกสาร)',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกินไป ลองเลือกรูปที่เล็กลง',

  // แชท / Support
  CANNOT_CHAT_WITH_OWN_SHOP: 'นี่คือร้านของคุณเอง',
  TICKET_CLOSED: 'เรื่องนี้ปิดแล้ว ตอบกลับไม่ได้ — แจ้งเรื่องใหม่หากยังมีปัญหา',

  // สมัครร้าน / คำเชิญ
  ALREADY_HAS_VENDOR: 'บัญชีนี้สมัครร้านไว้แล้ว',
  INVALID_NAME: 'กรุณากรอกชื่อร้าน',
  APPEAL_LIMIT_REACHED: 'ยื่นอุทธรณ์ครบ 5 ครั้งแล้ว กรุณาติดต่อ Admin โดยตรง',
  NOT_REJECTED: 'ยื่นอุทธรณ์ได้เฉพาะตอนถูกปฏิเสธเท่านั้น',
  REASON_REQUIRED: 'กรุณากรอกเหตุผล',
  NOT_INVITED: 'คำเชิญนี้ถูกใช้ไปแล้ว',

  // ทั่วไป
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ อาจถูกลบไปแล้ว',
  UNAUTHORIZED: 'กรุณาเข้าสู่ระบบอีกครั้ง',
};

const NETWORK_MESSAGE = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';

/**
 * Thai message for any thrown value. Unknown codes and unexpected errors fall back to
 * `fallback` (the screen's own "…ไม่สำเร็จ ลองใหม่อีกครั้ง"), never the raw code.
 */
export function errorMessageTh(err: unknown, fallback = 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'): string {
  if (err instanceof ApiError) {
    if (MESSAGES[err.message]) return MESSAGES[err.message];
    if (err.status === 401) return MESSAGES.UNAUTHORIZED;
    if (err.status >= 500) return 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่';
    return fallback;
  }
  // fetch() rejects with a TypeError when the server can't be reached at all.
  if (err instanceof TypeError) return NETWORK_MESSAGE;
  return fallback;
}

/** True when the error is a specific backend code (for screens that branch on it). */
export function isApiError(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.message === code;
}
