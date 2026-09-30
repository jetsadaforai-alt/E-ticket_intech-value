'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '../../../lib/AdminShell';
import { apiRequest, ApiError } from '../../../lib/api';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { TextArea } from '../../../components/ui/FormField';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { accountStatusMeta, TICKET_STATUS_TH } from '../../../lib/statusMeta';

type UserDetail = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  suspended_by: string | null;
  vendors_owned: { id: string; name: string }[];
  support_tickets: { id: string; category: string; status: string; createdAt: string }[];
  tickets: Record<string, number>;
  reviews: { id: string; rating: number; comment: string | null; created_at: string; event_id: string; event_title: string }[];
};

const dt = (iso: string) => new Date(iso).toLocaleString('th-TH');

function UserDetailBody() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<UserDetail>(`/v1/admin/users/${params.id}`);
    setUser(data);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setError('โหลดข้อมูลผู้ใช้ไม่สำเร็จ'));
  }, [load]);

  const onSuspend = async () => {
    if (!reason.trim()) {
      setError('กรุณากรอกเหตุผล');
      return;
    }
    const ok = await confirm({
      title: 'ยืนยันระงับบัญชีนี้?',
      message: 'ตั๋วที่ถืออยู่ทั้งหมดจะถูกยกเลิกทันทีและไม่ได้คืนกลับแม้จะปลดระงับภายหลัง',
      confirmLabel: 'ระงับบัญชี',
      danger: true,
    });
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/v1/admin/users/${params.id}/suspend`, { method: 'POST', body: { reason } });
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ระงับบัญชีไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const onUnsuspend = async () => {
    const ok = await confirm({
      title: 'ยืนยันปลดระงับบัญชีนี้?',
      message: 'ผู้ใช้จะกลับมาใช้งานได้ตามปกติ (ตั๋วที่ถูกยกเลิกไปแล้วจะไม่กลับมา)',
      confirmLabel: 'ปลดระงับ',
    });
    if (!ok) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/v1/admin/users/${params.id}/unsuspend`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ปลดระงับไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !user) return <ErrorState message={error} />;
  if (!user) return <LoadingState />;

  const meta = accountStatusMeta(user.status);

  return (
    <div className="max-w-2xl">
      <button onClick={() => router.push('/users')} className="mb-4 text-sm text-primary hover:underline">
        ← กลับไปที่รายการ
      </button>

      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">{user.name}</h1>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>

        <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-text-muted">เบอร์โทร</dt>
          <dd>{user.phone}</dd>
          <dt className="text-text-muted">อีเมล</dt>
          <dd>{user.email || '-'}</dd>
          <dt className="text-text-muted">สมัครเมื่อ</dt>
          <dd>{dt(user.created_at)}</dd>
          <dt className="text-text-muted">ตั๋ว</dt>
          <dd>
            {Object.entries(user.tickets).length === 0
              ? '-'
              : Object.entries(user.tickets)
                  .map(([s, n]) => `${TICKET_STATUS_TH[s] ?? s} ${n}`)
                  .join(' · ')}
          </dd>
          {user.vendors_owned.length > 0 && (
            <>
              <dt className="text-text-muted">เจ้าของร้านค้า</dt>
              <dd>{user.vendors_owned.map((v) => v.name).join(', ')}</dd>
            </>
          )}
          {user.support_tickets.length > 0 && (
            <>
              <dt className="text-text-muted">Support Ticket</dt>
              <dd>{user.support_tickets.length} เรื่อง</dd>
            </>
          )}
        </dl>

        {user.reviews.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm text-text-muted">รีวิวที่เขียน ({user.reviews.length})</div>
            <div className="space-y-2">
              {user.reviews.map((r) => (
                <div key={r.id} className="rounded-md border border-border p-2 text-sm">
                  <div className="font-medium">{r.event_title} — {r.rating} ดาว</div>
                  {r.comment && <div className="text-text-muted">{r.comment}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {user.status === 'suspended' ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-foreground">ผลการระงับ</h2>
          <dl className="mb-4 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-text-muted">เหตุผล</dt>
            <dd>{user.suspended_reason}</dd>
            <dt className="text-text-muted">เวลา</dt>
            <dd>{user.suspended_at ? dt(user.suspended_at) : '-'}</dd>
            <dt className="text-text-muted">ผู้ระงับ</dt>
            <dd>{user.suspended_by ?? '-'}</dd>
          </dl>
          {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
          <Button variant="secondary" onClick={onUnsuspend} loading={submitting}>
            {submitting ? 'กำลังปลดระงับ...' : 'ปลดระงับบัญชี'}
          </Button>
        </Card>
      ) : (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-foreground">ระงับบัญชีนี้</h2>
          <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
            ผู้ใช้จะเข้าสู่ระบบไม่ได้ทันที (เห็นเฉพาะหน้าแจ้งเหตุผลและติดต่อเจ้าหน้าที่) และตั๋วที่ถืออยู่
            ทั้งหมดจะถูกยกเลิกทันที · <strong>ปลดระงับได้ภายหลัง แต่ตั๋วที่ถูกยกเลิกไปแล้วไม่คืน</strong>
          </div>
          {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="เหตุผลในการระงับ (บังคับกรอก)"
            className="mb-3"
          />
          <Button variant="danger" onClick={onSuspend} loading={submitting}>
            {submitting ? 'กำลังระงับ...' : 'ระงับบัญชี'}
          </Button>
        </Card>
      )}
      {dialog}
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <AdminShell>
      <UserDetailBody />
    </AdminShell>
  );
}
