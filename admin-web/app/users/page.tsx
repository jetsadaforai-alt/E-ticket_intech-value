'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '../../lib/AdminShell';
import { apiRequest } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { ListContainer } from '../../components/ui/States';
import { ListRow, FilterTabs } from '../../components/ui/ListRow';
import { TextInput } from '../../components/ui/FormField';
import { accountStatusMeta } from '../../lib/statusMeta';

type UserRow = {
  id: string;
  name: string;
  phone: string;
  status: string;
  suspended_at: string | null;
  created_at: string;
  ticket_count: number;
  review_count: number;
  owns_vendor: boolean;
};

function UserQueue() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [filter, setFilter] = useState<'active' | 'suspended' | 'all'>('active');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // re-fetch on filter/search change needs the loading flag reset synchronously; the
    // extra render is harmless here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (q.trim()) params.set('q', q.trim());
    const query = params.toString() ? `?${params.toString()}` : '';
    // Debounced by the browser being fast enough for a few hundred rows — no need for a
    // real debounce timer at this scale (same reasoning as elsewhere in admin-web).
    const timer = setTimeout(() => {
      apiRequest<UserRow[]>(`/v1/admin/users${query}`)
        .then(setItems)
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [filter, q]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">จัดการผู้ใช้</h1>
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'ปกติ' },
            { value: 'suspended', label: 'ถูกระงับ' },
            { value: 'all', label: 'ทั้งหมด' },
          ]}
        />
      </div>
      <p className="mb-3 text-sm text-text-muted">ตรวจสอบบัญชีผู้ใช้ และระงับบัญชีที่มีพฤติกรรมไม่เหมาะสม</p>

      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรือเบอร์โทร..." className="mb-4" />

      <ListContainer loading={loading} error={error} isEmpty={items.length === 0}>
        {items.map((item) => {
          const meta = accountStatusMeta(item.status);
          return (
            <ListRow
              key={item.id}
              href={`/users/${item.id}`}
              title={
                <>
                  {item.name} <span className="font-normal text-text-muted">· {item.phone}</span>
                </>
              }
              meta={
                <>
                  ตั๋ว {item.ticket_count} · รีวิว {item.review_count}
                  {item.owns_vendor && ' · เจ้าของร้านค้า'} · สมัครเมื่อ{' '}
                  {new Date(item.created_at).toLocaleDateString('th-TH')}
                </>
              }
              right={<Badge variant={meta.variant}>{meta.label}</Badge>}
            />
          );
        })}
      </ListContainer>
    </div>
  );
}

export default function UsersPage() {
  return (
    <AdminShell>
      <UserQueue />
    </AdminShell>
  );
}
