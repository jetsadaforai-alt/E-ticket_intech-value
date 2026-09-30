'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '../../../lib/AdminShell';
import { apiRequest, ApiError, API_BASE_URL } from '../../../lib/api';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { TextArea } from '../../../components/ui/FormField';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { eventStatusMeta, TICKET_STATUS_TH } from '../../../lib/statusMeta';

type EventDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  start_time: string;
  end_time: string;
  created_at: string;
  shop: { id: string; name: string; address: string | null };
  image_urls: string[];
  products: { name: string; price_baht: string }[];
  discount_value_baht: string | null;
  total_qty: number;
  remaining_count: number;
  tickets: Record<string, number>;
  redemption_window: { validFrom: string | null; validUntil: string | null; slots: { dayOfWeek: string; startTime: string; endTime: string }[] } | null;
  rating_average: number | null;
  rating_count: number;
  banned_at: string | null;
  banned_reason: string | null;
  banned_by: string | null;
};

const dt = (iso: string) => new Date(iso).toLocaleString('th-TH');

function EventDetailBody() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<EventDetail>(`/v1/admin/events/${params.id}`);
    setEvent(data);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setError('โหลดข้อมูล Event ไม่สำเร็จ'));
  }, [load]);

  const onBan = async () => {
    if (!reason.trim()) {
      setError('กรุณากรอกเหตุผล');
      return;
    }
    // Irreversible and it destroys tickets people are already holding, so make them
    // say yes twice.
    const ok = await confirm({
      title: 'ยืนยันระงับ Event นี้?',
      message: 'ตั๋วที่แจกไปแล้วทั้งหมดจะถูกยกเลิกทันที และกู้คืนไม่ได้',
      confirmLabel: 'ระงับ Event',
      danger: true,
    });
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/v1/admin/events/${params.id}/ban`, { method: 'POST', body: { reason } });
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ระงับ Event ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !event) return <ErrorState message={error} />;
  if (!event) return <LoadingState />;

  const meta = eventStatusMeta(event.status);

  return (
    <div className="max-w-2xl">
      <button onClick={() => router.push('/events')} className="mb-4 text-sm text-primary hover:underline">
        ← กลับไปที่รายการ
      </button>

      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">{event.title}</h1>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>

        <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-text-muted">ร้าน</dt>
          <dd>{event.shop.name}</dd>
          <dt className="text-text-muted">ที่อยู่</dt>
          <dd>{event.shop.address || '-'}</dd>
          <dt className="text-text-muted">ช่วงเวลา</dt>
          <dd>{dt(event.start_time)} – {dt(event.end_time)}</dd>
          <dt className="text-text-muted">ส่วนลด</dt>
          <dd>{event.discount_value_baht ?? '-'} บาท</dd>
          <dt className="text-text-muted">ตั๋ว</dt>
          <dd>
            {Object.entries(event.tickets).length === 0
              ? '-'
              : Object.entries(event.tickets)
                  .map(([s, n]) => `${TICKET_STATUS_TH[s] ?? s} ${n}`)
                  .join(' · ')}
          </dd>
          {event.rating_count > 0 && (
            <>
              <dt className="text-text-muted">คะแนนรีวิว</dt>
              <dd>{event.rating_average} ดาว จาก {event.rating_count} รีวิว</dd>
            </>
          )}
        </dl>

        {event.description && (
          <div className="mt-4">
            <div className="mb-1 text-sm text-text-muted">รายละเอียด</div>
            <p className="whitespace-pre-wrap text-sm">{event.description}</p>
          </div>
        )}

        {event.products.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-sm text-text-muted">สินค้าที่ร่วมรายการ</div>
            <p className="text-sm">{event.products.map((p) => p.name).join(', ')}</p>
          </div>
        )}

        {/* The reason images matter here: judging whether an event is inappropriate is
            mostly judging its pictures. */}
        <div className="mt-4">
          <div className="mb-2 text-sm text-text-muted">รูปภาพ ({event.image_urls.length})</div>
          {event.image_urls.length === 0 ? (
            <p className="text-sm text-text-muted">ไม่มีรูป</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {event.image_urls.map((url) => (
                <div key={url} className="h-32 w-32 overflow-hidden rounded-md border border-border bg-neutral-bubble">
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploads are served
                      from the API host, not the Next image pipeline */}
                  <img
                    src={`${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = 'hidden';
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {event.status === 'banned' ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-foreground">ผลการระงับ</h2>
          <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-text-muted">เหตุผล</dt>
            <dd>{event.banned_reason}</dd>
            <dt className="text-text-muted">เวลา</dt>
            <dd>{event.banned_at ? dt(event.banned_at) : '-'}</dd>
            <dt className="text-text-muted">ผู้ระงับ</dt>
            <dd>{event.banned_by ?? '-'}</dd>
          </dl>
        </Card>
      ) : event.status === 'active' ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-foreground">ระงับ Event นี้</h2>
          <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
            การระงับเป็นการถาวร — ตั๋วที่แจกไปแล้วจะถูกยกเลิกทั้งหมดและกู้คืนไม่ได้ · ร้านค้า
            <strong> ไม่ได้รับโควตาคืน</strong> · ร้านและผู้ถือตั๋วจะได้รับการแจ้งเตือน
          </div>
          {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="เหตุผลในการระงับ (บังคับกรอก)"
            className="mb-3"
          />
          <Button variant="danger" onClick={onBan} loading={submitting}>
            {submitting ? 'กำลังระงับ...' : 'ระงับ Event'}
          </Button>
        </Card>
      ) : (
        <Card className="text-sm text-text-muted">
          Event นี้{eventStatusMeta(event.status).label}แล้ว จึงไม่มีอะไรให้ระงับ
        </Card>
      )}
      {dialog}
    </div>
  );
}

export default function EventDetailPage() {
  return (
    <AdminShell>
      <EventDetailBody />
    </AdminShell>
  );
}
