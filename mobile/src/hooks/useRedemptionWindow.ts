import { useCallback, useState } from 'react';
import { toDateOnlyString } from '../utils/datetime';

export type RedemptionSlot = { dayOfWeek: string; startTime: string; endTime: string };

export const DAY_OPTIONS: { value: string; label: string }[] = [
  { value: 'MON', label: 'จ' },
  { value: 'TUE', label: 'อ' },
  { value: 'WED', label: 'พ' },
  { value: 'THU', label: 'พฤ' },
  { value: 'FRI', label: 'ศ' },
  { value: 'SAT', label: 'ส' },
  { value: 'SUN', label: 'อา' },
];

export type RedemptionWindowPayload = {
  valid_from: string | null;
  valid_until: string | null;
  slots: { day_of_week: string; start_time: string; end_time: string }[];
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Shared state + validation for the "เงื่อนไขการใช้สิทธิ์" block, used by both the
 * create and the manage screen. The two screens differ only in when they send the
 * payload (manage has its own save button; create sends it right after the event
 * exists), so saving is deliberately left to the caller.
 */
export function useRedemptionWindow() {
  const [validFrom, setValidFrom] = useState<Date | null>(null);
  const [validUntil, setValidUntil] = useState<Date | null>(null);
  const [slots, setSlots] = useState<RedemptionSlot[]>([]);
  const [newSlotDays, setNewSlotDays] = useState<string[]>([]);
  const [newSlotStart, setNewSlotStart] = useState('');
  const [newSlotEnd, setNewSlotEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (day: string) => {
    setNewSlotDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  // One time range fans out into one row per selected day — the backend stores slots
  // per weekday, but picking "Mon+Wed+Fri, 18:00-20:00" as three separate entries is
  // tedious for the shop.
  const addSlotRows = () => {
    setError(null);
    if (newSlotDays.length === 0) {
      setError('เลือกวันอย่างน้อย 1 วัน');
      return;
    }
    if (!TIME_PATTERN.test(newSlotStart) || !TIME_PATTERN.test(newSlotEnd)) {
      setError('รูปแบบเวลาไม่ถูกต้อง ใช้รูปแบบ HH:mm เช่น 18:00');
      return;
    }
    if (newSlotEnd <= newSlotStart) {
      setError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มภายในวันเดียวกัน');
      return;
    }
    const newRows: RedemptionSlot[] = newSlotDays.map((day) => ({
      dayOfWeek: day,
      startTime: newSlotStart,
      endTime: newSlotEnd,
    }));
    setSlots((prev) => [...prev, ...newRows]);
    setNewSlotDays([]);
    setNewSlotStart('');
    setNewSlotEnd('');
  };

  const removeSlot = (index: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Replaces the whole block — used to hydrate from the server on the manage screen.
   * Memoised with a stable identity (useState setters never change) because the manage
   * screen lists it in a useCallback dependency array; an unstable one would make its
   * load() a new function every render and spin the fetch effect forever.
   */
  const hydrate = useCallback(
    (next: { validFrom: Date | null; validUntil: Date | null; slots: RedemptionSlot[] }) => {
      setValidFrom(next.validFrom);
      setValidUntil(next.validUntil);
      setSlots(next.slots);
    },
    []
  );

  const clear = () => {
    setValidFrom(null);
    setValidUntil(null);
    setSlots([]);
    setNewSlotDays([]);
    setNewSlotStart('');
    setNewSlotEnd('');
  };

  /** Nothing configured at all — the create screen skips its extra request in that case. */
  const isEmpty = !validFrom && !validUntil && slots.length === 0;

  /**
   * Returns an error message, or null when the block is coherent. `eventEndsAt` lets the
   * create screen catch `valid_until > end_time` BEFORE the event exists — the backend
   * rejects it with 400, and finding out afterwards would leave a half-configured event.
   */
  const validate = (eventEndsAt?: Date | null): string | null => {
    if (validFrom && validUntil && validUntil < validFrom) {
      return 'วันสิ้นสุดต้องอยู่หลังวันเริ่ม';
    }
    if (eventEndsAt && validUntil && validUntil > eventEndsAt) {
      return 'วันสิ้นสุดของเงื่อนไขต้องไม่เกินวันสิ้นสุดของ Event';
    }
    return null;
  };

  const toPayload = (): RedemptionWindowPayload => ({
    valid_from: validFrom ? toDateOnlyString(validFrom) : null,
    valid_until: validUntil ? toDateOnlyString(validUntil) : null,
    slots: slots.map((s) => ({ day_of_week: s.dayOfWeek, start_time: s.startTime, end_time: s.endTime })),
  });

  return {
    validFrom,
    validUntil,
    slots,
    newSlotDays,
    newSlotStart,
    newSlotEnd,
    error,
    setValidFrom,
    setValidUntil,
    setNewSlotStart,
    setNewSlotEnd,
    setError,
    toggleDay,
    addSlotRows,
    removeSlot,
    hydrate,
    clear,
    isEmpty,
    validate,
    toPayload,
  };
}

export type RedemptionWindowController = ReturnType<typeof useRedemptionWindow>;
