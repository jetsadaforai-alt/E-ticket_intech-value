'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '../../../lib/AdminShell';
import { apiRequest, ApiError } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import { useAuth } from '../../../lib/AuthContext';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { TextArea, Select } from '../../../components/ui/FormField';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { SUPPORT_STATUS } from '../../../lib/statusMeta';

type Message = { id: string; senderType: 'user' | 'admin'; message: string; createdAt: string };
type TicketDetail = {
  id: string;
  category: string;
  status: string;
  resolutionNote: string | null;
  raisedBy: { name: string; phone: string };
  assignedAdmin: { id: string; username: string } | null;
  userLastReadAt: string | null;
  messages: Message[];
};

const STATUSES = Object.keys(SUPPORT_STATUS) as (keyof typeof SUPPORT_STATUS)[];

function SupportDetailBody() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { admin } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<TicketDetail>(`/v1/admin/support-tickets/${params.id}`);
    setTicket(data);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setError('โหลดเรื่องแจ้งปัญหาไม่สำเร็จ'));
  }, [load]);

  // Real-time updates come from the 'changed' socket event (see lib/socket.ts and
  // backend/src/services/realtime.js). The 60s poll is a fallback only, in case the
  // socket drops and silently fails to reconnect.
  useEffect(() => {
    const socket = getSocket();
    socket.emit('join-ticket', params.id);
    const onChanged = () => load().catch(() => {});
    socket.on('changed', onChanged);

    const timer = setInterval(onChanged, 60_000);
    return () => {
      clearInterval(timer);
      socket.off('changed', onChanged);
    };
  }, [load, params.id]);

  const onReply = async (status?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/v1/admin/support-tickets/${params.id}`, {
        method: 'PATCH',
        body: { message: message.trim() || undefined, status },
      });
      setMessage('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ส่งคำตอบไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !ticket) return <ErrorState message={error} />;
  if (!ticket) return <LoadingState />;

  const isClosed = ticket.status === 'closed';
  const claimedByOther = ticket.assignedAdmin !== null && ticket.assignedAdmin.id !== admin?.id;
  const composerDisabled = isClosed || claimedByOther;

  return (
    <div className="max-w-2xl">
      <button onClick={() => router.push('/support')} className="mb-4 text-sm text-primary hover:underline">
        ← กลับไปที่คิว
      </button>

      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold text-foreground">{ticket.raisedBy.name} ({ticket.raisedBy.phone})</div>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            สถานะ Ticket
            <Select
              value={ticket.status}
              onChange={(e) => onReply(e.target.value)}
              disabled={claimedByOther}
              className="w-auto py-1 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{SUPPORT_STATUS[s].label}</option>
              ))}
            </Select>
          </label>
        </div>
        <div className="text-xs text-text-muted">
          {ticket.assignedAdmin ? `รับเรื่องโดย ${ticket.assignedAdmin.username}` : 'ยังไม่มีคนรับเรื่อง'}
        </div>

        <div className="mt-4 space-y-3">
          {ticket.messages.map((m) => {
            const read = m.senderType === 'admin' && ticket.userLastReadAt && ticket.userLastReadAt >= m.createdAt;
            return (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-lg p-3 text-sm ${m.senderType === 'admin' ? 'ml-auto bg-primary-soft' : 'bg-neutral-bubble'}`}
              >
                <div className="mb-1 text-xs text-text-muted">{m.senderType === 'admin' ? 'Admin' : 'ผู้ใช้'}</div>
                {m.message}
                {m.senderType === 'admin' && (
                  <div className="mt-1 text-right text-[10px] text-text-muted">{read ? 'อ่านแล้ว' : 'ส่งแล้ว'}</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
        {claimedByOther && (
          <div className="mb-3 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            Admin {ticket.assignedAdmin?.username} กำลังดูแล ticket นี้อยู่ — ตอบเรื่องนี้ไม่ได้
          </div>
        )}
        {isClosed && !claimedByOther && (
          <div className="mb-3 rounded-md bg-neutral-bubble px-3 py-2 text-sm text-text-muted">Ticket นี้ปิดแล้ว ตอบเพิ่มไม่ได้</div>
        )}
        <TextArea
          rows={3}
          placeholder="พิมพ์ข้อความตอบกลับ..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={composerDisabled}
          className="mb-3"
        />
        <div className="flex gap-3">
          <Button onClick={() => onReply()} disabled={submitting || !message.trim() || composerDisabled} loading={submitting}>
            ส่งข้อความ
          </Button>
          {!isClosed && (
            <Button
              variant="secondary"
              onClick={() => onReply('closed')}
              disabled={submitting || !message.trim() || composerDisabled}
              loading={submitting}
            >
              ตอบและปิด Ticket
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function SupportDetailPage() {
  return (
    <AdminShell>
      <SupportDetailBody />
    </AdminShell>
  );
}
