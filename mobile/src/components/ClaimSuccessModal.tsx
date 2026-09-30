import React from 'react';
import { ConfirmModal } from './ConfirmModal';

type Props = {
  visible: boolean;
  onViewTicket: () => void;
  onGoHome: () => void;
};

/** Thin wrapper around ConfirmModal — kept as its own component so ClaimTicketScreen.tsx
 * (its only caller) didn't need to change when the shell was generalized. */
export function ClaimSuccessModal({ visible, onViewTicket, onGoHome }: Props) {
  return (
    <ConfirmModal
      visible={visible}
      icon="checkmark"
      title="รับตั๋วสำเร็จ!"
      subtitle="ตั๋วย้ายมาอยู่ใน ตั๋วของฉัน แล้ว เปิด QR ให้พนักงานสแกนเพื่อใช้สิทธิ์ได้เลย"
      primaryLabel="ดูตั๋วของฉัน"
      onPrimary={onViewTicket}
      secondaryLabel="กลับสู่หน้าหลัก"
      onSecondary={onGoHome}
    />
  );
}
