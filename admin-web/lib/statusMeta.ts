// Single source of truth for status → (Thai label, badge color) across the app.
// Before this file every page (vendors/events/users/support) redeclared its own
// STATUS_LABEL/STATUS_COLOR maps, which is how the same semantic status ended up
// with different colors/paddings on different pages.
import type { BadgeVariant } from '../components/ui/Badge';

export type StatusMeta = { label: string; variant: BadgeVariant };

function lookup(map: Record<string, StatusMeta>, status: string): StatusMeta {
  return map[status] ?? { label: status, variant: 'neutral' };
}

export const VENDOR_VERIFICATION_STATUS: Record<string, StatusMeta> = {
  pending: { label: 'รอตรวจสอบ', variant: 'warning' },
  approved: { label: 'อนุมัติแล้ว', variant: 'success' },
  rejected: { label: 'ปฏิเสธแล้ว', variant: 'danger' },
};
export const vendorVerificationMeta = (status: string) => lookup(VENDOR_VERIFICATION_STATUS, status);

// Shared by both Vendor.status and User.status — 'active' vs a platform-imposed
// 'suspended' lockout means the same thing (and should look the same) on either.
export const ACCOUNT_STATUS: Record<string, StatusMeta> = {
  active: { label: 'ปกติ', variant: 'success' },
  suspended: { label: 'ถูกระงับ', variant: 'orange' },
};
export const accountStatusMeta = (status: string) => lookup(ACCOUNT_STATUS, status);

export const EVENT_STATUS: Record<string, StatusMeta> = {
  active: { label: 'เปิดอยู่', variant: 'success' },
  expired: { label: 'หมดเวลา', variant: 'neutral' },
  cancelled: { label: 'ร้านยกเลิกเอง', variant: 'danger' },
  // Distinct from cancelled on purpose — a vendor stopping their own promotion and the
  // platform taking one down are different events and shouldn't read the same.
  banned: { label: 'ถูกระงับ', variant: 'orange' },
};
export const eventStatusMeta = (status: string) => lookup(EVENT_STATUS, status);

export const SUPPORT_STATUS: Record<string, StatusMeta> = {
  open: { label: 'เปิดเรื่อง', variant: 'warning' },
  investigating: { label: 'กำลังตรวจสอบ', variant: 'info' },
  resolved: { label: 'แก้ไขแล้ว', variant: 'success' },
  closed: { label: 'ปิดแล้ว', variant: 'neutral' },
};
export const supportStatusMeta = (status: string) => lookup(SUPPORT_STATUS, status);

export const SUPPORT_CATEGORY_TH: Record<string, string> = {
  redemption_dispute: 'ข้อโต้แย้งการใช้สิทธิ์',
  billing_issue: 'ปัญหาการเงิน',
  fraud_report: 'แจ้งการทุจริต',
  other: 'อื่นๆ',
};

export const TICKET_STATUS_TH: Record<string, string> = {
  AVAILABLE: 'ว่าง',
  RESERVED: 'จองไว้',
  ISSUED: 'ออกให้แล้ว',
  REDEEMED: 'ใช้แล้ว',
  CANCELLED: 'ยกเลิก',
};
