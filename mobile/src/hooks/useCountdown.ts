import { useEffect, useMemo, useState } from 'react';

/**
 * Countdown ที่ derive จาก expiry timestamp ทุก tick แทนการนับถอยหลังจากตัวเลขคงที่ตอน mount
 * — กัน drift ถ้า component re-render ช้าหรือเครื่อง sleep ไปช่วงหนึ่ง การตัดสินว่า "หมดอายุจริง"
 * ยังอยู่ที่ backend เสมอ (Redis TTL ของ qrtoken) ตัวเลขนี้เป็นแค่ UI feedback
 */
export function useCountdown(expiresAtIso: string | null) {
  const expiresAtMs = useMemo(() => (expiresAtIso ? new Date(expiresAtIso).getTime() : null), [expiresAtIso]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAtMs === null) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [expiresAtMs]);

  if (expiresAtMs === null) return { secondsLeft: 0, isExpired: false };

  const secondsLeft = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
  return { secondsLeft, isExpired: secondsLeft <= 0 };
}
