'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '../../lib/AdminShell';
import { apiRequest } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { ListContainer } from '../../components/ui/States';
import { ListRow, FilterTabs } from '../../components/ui/ListRow';
import { vendorVerificationMeta } from '../../lib/statusMeta';

type VendorVerification = {
  id: string;
  vendorId: string;
  status: string;
  appealCount: number;
  createdAt: string;
  vendor: { name: string };
};

function VendorQueue() {
  const [items, setItems] = useState<VendorVerification[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // re-fetch on filter change needs the loading flag reset synchronously; the extra render is harmless here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    const query = filter === 'pending' ? '?status=pending' : '';
    apiRequest<VendorVerification[]>(`/v1/admin/vendors${query}`)
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">ร้านค้ารออนุมัติ</h1>
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: 'รอตรวจสอบ' },
            { value: 'all', label: 'ทั้งหมด' },
          ]}
        />
      </div>

      <ListContainer loading={loading} error={error} isEmpty={items.length === 0}>
        {items.map((item) => {
          const meta = vendorVerificationMeta(item.status);
          return (
            <ListRow
              key={item.id}
              href={`/vendors/${item.vendorId}`}
              title={item.vendor.name}
              meta={
                <>
                  ยื่นเมื่อ {new Date(item.createdAt).toLocaleDateString('th-TH')}
                  {item.appealCount > 0 && ` · อุทธรณ์ ${item.appealCount}/5 ครั้ง`}
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

export default function VendorsPage() {
  return (
    <AdminShell>
      <VendorQueue />
    </AdminShell>
  );
}
