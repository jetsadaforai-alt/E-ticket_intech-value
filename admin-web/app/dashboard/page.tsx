'use client';

import React, { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import AdminShell from '../../lib/AdminShell';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { StatCard, BreakdownCard, ChartCard, SectionTitle } from '../../components/ui/DashboardCards';
import type { BadgeVariant } from '../../components/ui/Badge';
import { vendorVerificationMeta, eventStatusMeta, supportStatusMeta, TICKET_STATUS_TH } from '../../lib/statusMeta';

type Point = { day: string; value: number };

type Dashboard = {
  vendors: { pending: number; approved: number; rejected: number; total: number };
  shops: { total: number };
  users: { total: number };
  events: { active: number; expired: number; cancelled: number; total: number };
  // EXPIRED is absent on purpose — nothing ever writes that status (see the backend route).
  tickets: {
    AVAILABLE: number; RESERVED: number; ISSUED: number;
    REDEEMED: number; CANCELLED: number; total: number;
  };
  supportTickets: { open: number; investigating: number; resolved: number; closed: number; total: number };
  admins: { active: number };
  redemptionsToday: number;
  revenue: {
    total: number;
    order_count: number;
    average_order: number;
    by_type: { type: string; amount: number; count: number }[];
    by_tier: { package_code: string; amount: number; count: number }[];
  };
  quota: {
    outstanding_tickets: number;
    outstanding_events: number;
    ledger: { reason: string; ticket_delta: number; event_delta: number; entries: number }[];
  };
  value: { discount_redeemed: number; tickets_issued: number; tickets_redeemed: number };
  packages: { code: string; name: string; tier: number; vendor_count: number }[];
  unknown_package_vendors: number;
  reviews: { average: number | null; count: number; distribution: Record<string, number> };
  trends: { days: number; revenue: Point[]; redemptions: Point[] };
};

const PURCHASE_TYPE_TH: Record<string, string> = {
  package: 'ซื้อแพ็กเกจ',
  event_topup: 'ซื้อสิทธิ์ Event เพิ่ม',
  ticket_topup: 'ซื้อตั๋วเพิ่ม',
};

const LEDGER_REASON_TH: Record<string, string> = {
  purchase: 'เติมจากการซื้อ',
  event_created: 'ใช้ไปกับการสร้าง Event',
  event_cancelled: 'คืนจาก Event ที่ยกเลิก',
  event_expired: 'คืนจาก Event ที่หมดอายุ',
  event_topup: 'โอนเข้า Event เจาะจง',
  admin_adjust: 'Admin ปรับด้วยมือ',
};

// No statusMeta equivalent exists for ticket status (statusMeta only carries the label
// map, not a variant) since tickets aren't a queue admins triage like the others.
const TICKET_VARIANT: Record<'AVAILABLE' | 'ISSUED' | 'REDEEMED' | 'CANCELLED', BadgeVariant> = {
  AVAILABLE: 'neutral',
  ISSUED: 'info',
  REDEEMED: 'success',
  CANCELLED: 'danger',
};

const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
/** '2026-08-17' → '17/08' — the axis only needs enough to place the point in the month. */
const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
// Recharts hands its formatters loosely-typed values, so these take the wide type and
// narrow it here rather than lying about the signature.
const bahtTooltip = (v: unknown) => baht(Number(v) || 0);
const dayTooltip = (label: React.ReactNode) => String(label ?? '');

function DashboardBody() {
  const { admin } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiRequest<Dashboard>('/v1/superadmin/dashboard')
      .then(setData)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
      .catch(() => setError(true));
  }, []);

  // Matches the guard the other SuperAdmin pages use. Without it an Admin who types the
  // URL sees a generic load failure instead of being told the page isn't theirs.
  if (admin?.role !== 'super_admin') {
    return <ErrorState message="หน้านี้สำหรับ SuperAdmin เท่านั้น" />;
  }
  if (error) return <ErrorState message="โหลด Dashboard ไม่สำเร็จ" />;
  if (!data) return <LoadingState />;

  const redeemRate =
    data.value.tickets_issued === 0
      ? null
      : Math.round((data.value.tickets_redeemed / data.value.tickets_issued) * 100);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-text-muted mb-4">ภาพรวมทั้งแพลตฟอร์ม สำหรับใช้ประกอบการตั้งราคาแพ็กเกจและดูสุขภาพระบบ</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="รายได้รวม"
          value={baht(data.revenue.total)}
          hint={`${data.revenue.order_count.toLocaleString('th-TH')} รายการ · เฉลี่ย ${baht(data.revenue.average_order)}`}
          accent="info"
        />
        <StatCard
          label="โควตาคงค้าง"
          value={`${data.quota.outstanding_tickets.toLocaleString('th-TH')} ตั๋ว`}
          hint={`+ สิทธิ์สร้าง Event ${data.quota.outstanding_events.toLocaleString('th-TH')} ครั้ง`}
          accent="warning"
        />
        <StatCard
          label="ส่วนลดที่ผู้ใช้ได้รับจริง"
          value={baht(data.value.discount_redeemed)}
          hint={redeemRate === null ? 'ยังไม่มีตั๋วที่ออก' : `ใช้จริง ${redeemRate}% ของตั๋วที่ออกไป`}
          accent="success"
        />
        <StatCard
          label="Redeem วันนี้"
          value={data.redemptionsToday.toLocaleString('th-TH')}
          hint={`ร้านรออนุมัติ ${data.vendors.pending.toLocaleString('th-TH')} ราย`}
        />
      </div>

      <SectionTitle>แนวโน้ม {data.trends.days} วันล่าสุด</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="รายได้รายวัน" note="นับเฉพาะรายการที่ชำระเงินสำเร็จแล้ว">
          <LineChart data={data.trends.revenue} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} interval={6} />
            <YAxis tick={{ fontSize: 11 }} width={48} />
            <Tooltip formatter={bahtTooltip} labelFormatter={dayTooltip} />
            <Line type="monotone" dataKey="value" stroke="var(--chart-2)" strokeWidth={2} dot={false} name="รายได้" />
          </LineChart>
        </ChartCard>
        <ChartCard title="การใช้สิทธิ์รายวัน">
          <BarChart data={data.trends.redemptions} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} interval={6} />
            <YAxis tick={{ fontSize: 11 }} width={48} allowDecimals={false} />
            <Tooltip labelFormatter={dayTooltip} />
            <Bar dataKey="value" fill="var(--chart-4)" name="ใช้สิทธิ์" />
          </BarChart>
        </ChartCard>
      </div>

      <SectionTitle>เงินและแพ็กเกจ</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BreakdownCard
          title="รายได้แยกตามประเภท"
          rows={data.revenue.by_type.map((r) => ({
            label: PURCHASE_TYPE_TH[r.type] ?? r.type,
            value: `${baht(r.amount)} (${r.count})`,
            variant: 'info' as const,
          }))}
        />
        <BreakdownCard
          title="รายได้แยกตาม tier"
          rows={data.revenue.by_tier.map((r) => ({
            label: r.package_code,
            value: `${baht(r.amount)} (${r.count})`,
            variant: 'brand' as const,
          }))}
          note="อิงราคา ณ เวลาที่ขาย ไม่ใช่ราคาปัจจุบัน"
        />
        <BreakdownCard
          title="ร้านค้าต่อแพ็กเกจ"
          rows={[
            ...data.packages.map((p) => ({
              label: p.name,
              value: `${p.vendor_count.toLocaleString('th-TH')} ร้าน`,
              variant: 'neutral' as const,
            })),
            ...(data.unknown_package_vendors > 0
              ? [{
                  label: 'แพ็กเกจที่ไม่รู้จัก',
                  value: `${data.unknown_package_vendors} ร้าน`,
                  variant: 'danger' as const,
                }]
              : []),
          ]}
        />
      </div>

      <SectionTitle>เศรษฐกิจโควตา</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownCard
          title="ความเคลื่อนไหวของโควตาตั๋ว (แยกตามสาเหตุ)"
          rows={data.quota.ledger.map((r) => ({
            label: LEDGER_REASON_TH[r.reason] ?? r.reason,
            value: `${r.ticket_delta > 0 ? '+' : ''}${r.ticket_delta.toLocaleString('th-TH')} ใบ`,
            variant: r.ticket_delta >= 0 ? ('success' as const) : ('orange' as const),
          }))}
          note="บวก = เข้ากองโควตา · ลบ = ถูกใช้ออกไป"
        />
        <BreakdownCard
          title="คะแนนรีวิว"
          rows={
            data.reviews.count === 0
              ? []
              : [5, 4, 3, 2, 1].map((n) => ({
                  label: `${n} ดาว`,
                  value: (data.reviews.distribution[String(n)] ?? 0).toLocaleString('th-TH'),
                  variant: 'warning' as const,
                }))
          }
          note={
            data.reviews.count === 0
              ? 'ยังไม่มีรีวิว'
              : `เฉลี่ย ${data.reviews.average} ดาว จาก ${data.reviews.count.toLocaleString('th-TH')} รีวิว`
          }
        />
      </div>

      <SectionTitle>สถานะระบบ</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownCard
          title="สถานะร้านค้า (Vendor Verification)"
          rows={(['pending', 'approved', 'rejected'] as const).map((status) => ({
            label: vendorVerificationMeta(status).label,
            value: String(data.vendors[status]),
            variant: vendorVerificationMeta(status).variant,
          }))}
        />
        <BreakdownCard
          title="สถานะ Event"
          rows={(['active', 'expired', 'cancelled'] as const).map((status) => ({
            label: eventStatusMeta(status).label,
            value: String(data.events[status]),
            variant: eventStatusMeta(status).variant,
          }))}
        />
        <BreakdownCard
          title="สถานะตั๋ว"
          rows={(['AVAILABLE', 'ISSUED', 'REDEEMED', 'CANCELLED'] as const).map((status) => ({
            label: TICKET_STATUS_TH[status],
            value: String(data.tickets[status]),
            variant: TICKET_VARIANT[status],
          }))}
        />
        <BreakdownCard
          title="Support Ticket"
          rows={(['open', 'investigating', 'resolved', 'closed'] as const).map((status) => ({
            label: supportStatusMeta(status).label,
            value: String(data.supportTickets[status]),
            variant: supportStatusMeta(status).variant,
          }))}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AdminShell>
      <DashboardBody />
    </AdminShell>
  );
}
