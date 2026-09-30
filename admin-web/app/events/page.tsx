'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '../../lib/AdminShell';
import { apiRequest } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { ListContainer } from '../../components/ui/States';
import { ListRow, FilterTabs } from '../../components/ui/ListRow';
import { eventStatusMeta } from '../../lib/statusMeta';

type EventRow = {
  id: string;
  title: string;
  shop_name: string;
  status: string;
  start_time: string;
  end_time: string;
  total_qty: number;
  remaining_count: number;
  created_at: string;
  banned_at: string | null;
};

function EventQueue() {
  const [items, setItems] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<'active' | 'banned' | 'all'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // re-fetch on filter change needs the loading flag reset synchronously; the extra render is harmless here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    const query = filter === 'all' ? '' : `?status=${filter}`;
    apiRequest<EventRow[]>(`/v1/admin/events${query}`)
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">จัดการ Event</h1>
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'เปิดอยู่' },
            { value: 'banned', label: 'ถูกระงับ' },
            { value: 'all', label: 'ทั้งหมด' },
          ]}
        />
      </div>
      <p className="mb-4 text-sm text-text-muted">ตรวจสอบ Event ที่ร้านค้าเผยแพร่ และระงับรายการที่ไม่เหมาะสม</p>

      <ListContainer loading={loading} error={error} isEmpty={items.length === 0}>
        {items.map((item) => {
          const meta = eventStatusMeta(item.status);
          return (
            <ListRow
              key={item.id}
              href={`/events/${item.id}`}
              title={item.title}
              meta={
                <>
                  {item.shop_name} · ตั๋ว {item.remaining_count}/{item.total_qty} ·{' '}
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

export default function EventsPage() {
  return (
    <AdminShell>
      <EventQueue />
    </AdminShell>
  );
}
