'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminShell from '../../lib/AdminShell';
import { apiRequest, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/States';

type Package = {
  id: string;
  code: string;
  name: string;
  tier: number;
  price_baht: number;
  event_quota: number;
  ticket_per_event: number;
  ticket_total: number;
  event_topup_price: number;
  ticket_topup_price: number;
  topup_enabled: boolean;
  is_active: boolean;
};

/** The numeric columns SuperAdmin may edit, in the order they appear in the table. */
const FIELDS = [
  { key: 'priceBaht', label: 'ราคาแพ็กเกจ (฿)', from: (p: Package) => p.price_baht },
  { key: 'eventQuota', label: 'Event ที่สร้างได้', from: (p: Package) => p.event_quota },
  { key: 'ticketPerEvent', label: 'ตั๋วต่อ Event (เพดาน)', from: (p: Package) => p.ticket_per_event },
  { key: 'eventTopupPrice', label: 'ซื้อ Event เพิ่ม (฿/ครั้ง)', from: (p: Package) => p.event_topup_price },
  { key: 'ticketTopupPrice', label: 'ซื้อตั๋วเพิ่ม (฿/ชุด)', from: (p: Package) => p.ticket_topup_price },
] as const;

type Draft = Record<string, string>;

function PackagesBody() {
  const { admin } = useAuth();
  const [packages, setPackages] = useState<Package[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<Package[]>('/v1/superadmin/packages');
    setPackages(data);
    setDrafts(
      Object.fromEntries(
        data.map((p) => [
          p.id,
          { name: p.name, ...Object.fromEntries(FIELDS.map((f) => [f.key, String(f.from(p))])) },
        ])
      )
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setError('โหลดรายการแพ็กเกจไม่สำเร็จ'));
  }, [load]);

  const onSave = async (pkg: Package) => {
    setError(null);
    setSaved(null);
    setSavingId(pkg.id);
    try {
      const draft = drafts[pkg.id] ?? {};
      const name = (draft.name ?? '').trim();
      if (!name) {
        setError(`ชื่อแพ็กเกจของ ${pkg.name} ห้ามว่าง`);
        return;
      }
      const body: Record<string, number | string> = { name };
      for (const field of FIELDS) {
        const value = Number(draft[field.key]);
        if (!Number.isFinite(value) || value < 0) {
          setError(`${field.label} ของ ${pkg.name} ไม่ถูกต้อง`);
          return;
        }
        body[field.key] = value;
      }
      await apiRequest(`/v1/superadmin/packages/${pkg.id}`, { method: 'PATCH', body });
      await load();
      setSaved(name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  if (admin?.role !== 'super_admin') {
    return <ErrorState message="หน้านี้สำหรับ SuperAdmin เท่านั้น" />;
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-foreground">แพ็กเกจ &amp; ราคา</h1>
      <p className="mb-4 text-sm text-text-muted">
        โมเดล Pay per Event — แพ็กเกจให้ทั้ง <strong>กองตั๋วรวม</strong> (Event ที่สร้างได้ × ตั๋วต่อ Event),{' '}
        <strong>จำนวน Event</strong> ที่สร้างได้ และ <strong>เพดานตั๋วต่อ 1 Event</strong>
      </p>

      <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
        การแก้ราคามีผลกับการซื้อครั้งใหม่เท่านั้น — ใบเสร็จเดิมและเพดานตั๋วของ Event ที่สร้างไปแล้วไม่เปลี่ยนตาม
      </div>

      {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
      {saved && <div className="mb-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success">บันทึก {saved} แล้ว</div>}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-primary-soft text-left">
              <th className="p-3 font-medium text-foreground">แพ็กเกจ</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="whitespace-nowrap p-3 font-medium text-foreground">
                  {f.label}
                </th>
              ))}
              <th className="whitespace-nowrap p-3 font-medium text-foreground">ตั๋วรวม</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {packages.map((pkg) => (
              <tr key={pkg.id}>
                <td className="p-3">
                  <input
                    type="text"
                    className="w-32 rounded-md border border-border bg-surface px-2 py-1 font-medium text-foreground"
                    value={drafts[pkg.id]?.name ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [pkg.id]: { ...prev[pkg.id], name: e.target.value },
                      }))
                    }
                  />
                  <div className="mt-1 text-xs text-text-muted">
                    tier {pkg.tier}
                    {!pkg.topup_enabled && ' · ซื้อเพิ่มไม่ได้'}
                  </div>
                </td>
                {FIELDS.map((f) => (
                  <td key={f.key} className="p-3">
                    <input
                      type="number"
                      min={0}
                      step={f.key.includes('Price') ? '0.01' : '1'}
                      // Free has no top-up prices to set — the package cannot top up at all.
                      disabled={!pkg.topup_enabled && f.key.includes('Topup')}
                      className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-foreground disabled:bg-neutral-bubble disabled:text-text-muted"
                      value={drafts[pkg.id]?.[f.key] ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [pkg.id]: { ...prev[pkg.id], [f.key]: e.target.value },
                        }))
                      }
                    />
                  </td>
                ))}
                <td className="whitespace-nowrap p-3 text-text-muted">
                  {Number(drafts[pkg.id]?.eventQuota ?? 0) * Number(drafts[pkg.id]?.ticketPerEvent ?? 0)} ใบ
                </td>
                <td className="p-3">
                  <Button onClick={() => onSave(pkg)} loading={savingId === pkg.id}>
                    บันทึก
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PackagesPage() {
  return (
    <AdminShell>
      <PackagesBody />
    </AdminShell>
  );
}
