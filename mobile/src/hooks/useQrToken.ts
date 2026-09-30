import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';

const REFRESH_MARGIN_MS = 5000; // fetch ล่วงหน้าก่อนหมดอายุ ~5s กัน QR ค้างจอเป็นโค้ดที่ตายแล้ว

type QrTokenResponse = { token: string; expires_in_seconds: number };

type UseQrTokenResult = {
  token: string | null;
  expiresAt: string | null;
  error: string | null;
  /** true เมื่อ backend ตอบ 409 TICKET_NOT_REDEEMABLE — ตั๋วเปลี่ยนสถานะไปแล้ว (เช่น เพิ่งถูก redeem) */
  ticketNoLongerIssued: boolean;
  /** true ระหว่างกำลังขอ token ใบถัดไป — ใช้โชว์ "กำลังรีเฟรช" บนหน้าจอ */
  refreshing: boolean;
  /** ขอ token ใหม่ทันที (ปุ่ม "สร้าง QR ใหม่") — ไม่เปลี่ยนรอบเวลาอัตโนมัติ */
  retry: () => void;
};

/**
 * Dynamic QR ที่หมุนทุก 45-60 วินาที — fetch token ใหม่อัตโนมัติ
 * ก่อนตัวเดิมหมดอายุ ไม่ต้องรอ user กด refresh เอง backend ออก token ใหม่ทุกครั้งที่เรียก
 * (ตัวเก่ายังใช้ได้จนกว่า TTL หมด) จึงเรียกซ้ำได้ปลอดภัย
 *
 * backend คืน `expires_in_seconds` ไม่ใช่ absolute timestamp — แปลงเป็นเวลาสิ้นสุดฝั่ง client
 * ตอนที่ response มาถึง เพื่อให้ countdown มีจุดอ้างอิงเดียวกัน
 */
export function useQrToken(ticketId: string, enabled: boolean): UseQrTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticketNoLongerIssued, setTicketNoLongerIssued] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const fetchToken = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await apiRequest<QrTokenResponse>(`/v1/tickets/${ticketId}/qr-token`);
      if (cancelledRef.current) return;
      setRefreshing(false);
      const expiryMs = Date.now() + res.expires_in_seconds * 1000;
      setToken(res.token);
      setExpiresAt(new Date(expiryMs).toISOString());
      setError(null);
      const delay = Math.max(1000, res.expires_in_seconds * 1000 - REFRESH_MARGIN_MS);
      timeoutRef.current = setTimeout(fetchToken, delay);
    } catch (err) {
      if (cancelledRef.current) return;
      setRefreshing(false);
      if (err instanceof ApiError && err.message === 'TICKET_NOT_REDEEMABLE') {
        setTicketNoLongerIssued(true);
        return;
      }
      setError('สร้าง QR ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต — ระบบจะลองใหม่อัตโนมัติ');
      timeoutRef.current = setTimeout(fetchToken, 5000); // network hiccup — retry เบาๆ
    }
  }, [ticketId]);

  const retry = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    fetchToken();
  }, [fetchToken]);

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;
    fetchToken();
    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, fetchToken]);

  return { token, expiresAt, error, ticketNoLongerIssued, refreshing, retry };
}
