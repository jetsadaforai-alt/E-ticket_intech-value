export function formatDateTimeLabel(date: Date | null): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${d}/${m}/${y} ${hh}:${mm}`;
}

export function formatDateLabel(date: Date | null): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`;
}

export function formatIsoDateTime(iso: string): string {
  return formatDateTimeLabel(new Date(iso));
}

// validFrom/validUntil เป็น date-only column — คืน '' ถ้าไม่ได้ตั้งค่า เพื่อให้ caller
// เลือกข้อความแทนได้ (เช่น "ไม่จำกัดวันเริ่ม")
export function formatIsoDateOnly(iso: string | null): string {
  if (!iso) return '';
  return formatDateLabel(new Date(iso));
}

// valid_from/valid_until store only a calendar date — serialize as a bare
// YYYY-MM-DD so it round-trips regardless of the device's UTC offset.
export function toDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
