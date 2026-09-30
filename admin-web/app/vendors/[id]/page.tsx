'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '../../../lib/AdminShell';
import { apiRequest, ApiError } from '../../../lib/api';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { TextArea } from '../../../components/ui/FormField';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { vendorVerificationMeta } from '../../../lib/statusMeta';
import { resolveAssetUrl } from '../../../lib/assetUrl';

type VendorDetail = {
  id: string;
  name: string;
  verificationStatus: string;
  status: string; // active | suspended — separate axis from verificationStatus
  suspendedAt: string | null;
  suspendedReason: string | null;
  suspendedByAdmin: { username: string } | null;
  verification: {
    status: string;
    reason: string | null;
    appealCount: number;
    lastAppealReason: string | null;
    reviewedAt: string | null;
  };
  owners: { user: { name: string; phone: string } }[];
  shop: { name: string; address: string } | null;
  documents: { id: string; documentUrl: string }[];
};

function isImageDocument(url: string) {
  return /\.(jpe?g|png)$/i.test(url);
}

const dt = (iso: string) => new Date(iso).toLocaleString('th-TH');

function VendorDetailBody() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendSubmitting, setSuspendSubmitting] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<VendorDetail>(`/v1/admin/vendors/${params.id}`);
    setVendor(data);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setError('โหลดข้อมูลร้านค้าไม่สำเร็จ'));
  }, [load]);

  const onDecision = async (decision: 'approved' | 'rejected') => {
    if (!reason.trim()) {
      setError('กรุณากรอกเหตุผล');
      return;
    }
    setSubmitting(true);
    setError(null);
    setDecided(null);
    try {
      await apiRequest(`/v1/admin/vendors/${params.id}/decision`, { method: 'POST', body: { decision, reason } });
      setReason('');
      await load();
      setDecided(decision === 'approved' ? 'อนุมัติร้านค้าแล้ว' : 'ปฏิเสธคำขอแล้ว');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกผลการพิจารณาไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const onSuspend = async () => {
    if (!suspendReason.trim()) {
      setSuspendError('กรุณากรอกเหตุผล');
      return;
    }
    // Irreversible in effect even though the account lock itself can be undone: every
    // event this shop currently has live gets banned the same permanent way an
    // individually-banned event does, and those do not come back on unsuspend.
    const ok = await confirm({
      title: 'ยืนยันระงับร้านค้านี้?',
      message: 'Event ที่เปิดอยู่ทั้งหมดของร้านจะถูกระงับถาวร ตั๋วที่แจกไปแล้วถูกยกเลิกทันที และร้านจะไม่ได้รับโควตาคืน',
      confirmLabel: 'ระงับร้านค้า',
      danger: true,
    });
    if (!ok) return;

    setSuspendSubmitting(true);
    setSuspendError(null);
    try {
      await apiRequest(`/v1/admin/vendors/${params.id}/suspend`, { method: 'POST', body: { reason: suspendReason } });
      setSuspendReason('');
      await load();
    } catch (err) {
      setSuspendError(err instanceof ApiError ? err.message : 'ระงับร้านค้าไม่สำเร็จ');
    } finally {
      setSuspendSubmitting(false);
    }
  };

  const onUnsuspend = async () => {
    const ok = await confirm({
      title: 'ยืนยันปลดระงับร้านค้านี้?',
      message: 'ร้านจะกลับมาใช้งานได้ตามปกติ (Event ที่ถูกระงับไปแล้วจะไม่กลับมา)',
      confirmLabel: 'ปลดระงับ',
    });
    if (!ok) return;
    setSuspendSubmitting(true);
    setSuspendError(null);
    try {
      await apiRequest(`/v1/admin/vendors/${params.id}/unsuspend`, { method: 'POST' });
      await load();
    } catch (err) {
      setSuspendError(err instanceof ApiError ? err.message : 'ปลดระงับไม่สำเร็จ');
    } finally {
      setSuspendSubmitting(false);
    }
  };

  if (error && !vendor) return <ErrorState message={error} />;
  if (!vendor) return <LoadingState />;

  const owner = vendor.owners[0]?.user;
  const meta = vendorVerificationMeta(vendor.verification.status);

  return (
    <div className="max-w-2xl">
      <button onClick={() => router.push('/vendors')} className="mb-4 text-sm text-primary hover:underline">
        ← กลับไปที่คิว
      </button>

      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">{vendor.name}</h1>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>

        <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-text-muted">เจ้าของร้าน</dt>
          <dd>{owner?.name} ({owner?.phone})</dd>
          <dt className="text-text-muted">ร้าน</dt>
          <dd>{vendor.shop ? `${vendor.shop.name} — ${vendor.shop.address}` : 'ยังไม่ได้สร้างร้าน'}</dd>
          <dt className="text-text-muted">จำนวนครั้งที่อุทธรณ์</dt>
          <dd>{vendor.verification.appealCount} / 5</dd>
          {vendor.verification.lastAppealReason && (
            <>
              <dt className="text-text-muted">เหตุผลอุทธรณ์ล่าสุด</dt>
              <dd>{vendor.verification.lastAppealReason}</dd>
            </>
          )}
          {vendor.verification.reason && (
            <>
              <dt className="text-text-muted">เหตุผลการตัดสินล่าสุด</dt>
              <dd>{vendor.verification.reason}</dd>
            </>
          )}
        </dl>

        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">เอกสารยืนยันตัวตน</h3>
          {vendor.documents.length === 0 ? (
            <p className="text-sm text-text-muted">ไม่มีเอกสารแนบมา</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {vendor.documents.map((doc) => {
                const url = resolveAssetUrl(doc.documentUrl);
                if (!url) return null;
                return isImageDocument(doc.documentUrl) ? (
                  <a key={doc.id} href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- backend-served local file, not worth Next/Image's remote-pattern config */}
                    <img src={url} alt="เอกสารยืนยันตัวตน" className="h-24 w-24 rounded-md border border-border object-cover" />
                  </a>
                ) : (
                  <a
                    key={doc.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-24 w-24 items-center justify-center rounded-md border border-border text-xs text-primary hover:underline"
                  >
                    เปิดไฟล์ PDF
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">อนุมัติ / ปฏิเสธ</h2>
        {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
        {decided && <div className="mb-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success">{decided}</div>}
        <TextArea
          rows={3}
          placeholder="เหตุผล (บังคับกรอกทั้งสองกรณี)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mb-3"
        />
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => onDecision('approved')} loading={submitting} className="flex-1">
            อนุมัติ
          </Button>
          <Button variant="danger" onClick={() => onDecision('rejected')} loading={submitting} className="flex-1">
            ปฏิเสธ
          </Button>
        </div>
      </Card>

      {vendor.status === 'suspended' ? (
        <Card className="mt-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">ผลการระงับร้านค้า</h2>
          <dl className="mb-4 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-text-muted">เหตุผล</dt>
            <dd>{vendor.suspendedReason}</dd>
            <dt className="text-text-muted">เวลา</dt>
            <dd>{vendor.suspendedAt ? dt(vendor.suspendedAt) : '-'}</dd>
            <dt className="text-text-muted">ผู้ระงับ</dt>
            <dd>{vendor.suspendedByAdmin?.username ?? '-'}</dd>
          </dl>
          {suspendError && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{suspendError}</div>}
          <Button variant="secondary" onClick={onUnsuspend} loading={suspendSubmitting}>
            {suspendSubmitting ? 'กำลังปลดระงับ...' : 'ปลดระงับร้านค้า'}
          </Button>
        </Card>
      ) : (
        <Card className="mt-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">ระงับร้านค้านี้</h2>
          <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
            การระงับจะแบน Event ที่เปิดอยู่ทั้งหมดของร้านทันที ตั๋วที่แจกไปแล้วถูกยกเลิก และร้าน
            <strong> ไม่ได้รับโควตาคืน</strong> · Event ที่ถูกระงับไปแล้วจะไม่กลับมาแม้จะปลดระงับร้านภายหลัง
          </div>
          {suspendError && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{suspendError}</div>}
          <TextArea
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            rows={3}
            placeholder="เหตุผลในการระงับ (บังคับกรอก)"
            className="mb-3"
          />
          <Button variant="danger" onClick={onSuspend} loading={suspendSubmitting}>
            {suspendSubmitting ? 'กำลังระงับ...' : 'ระงับร้านค้า'}
          </Button>
        </Card>
      )}
      {dialog}
    </div>
  );
}

export default function VendorDetailPage() {
  return (
    <AdminShell>
      <VendorDetailBody />
    </AdminShell>
  );
}
