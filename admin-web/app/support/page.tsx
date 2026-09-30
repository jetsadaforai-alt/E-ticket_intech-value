'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '../../lib/AdminShell';
import { apiRequest } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ListContainer } from '../../components/ui/States';
import { ListRow } from '../../components/ui/ListRow';
import { supportStatusMeta, SUPPORT_CATEGORY_TH } from '../../lib/statusMeta';

type SupportTicket = {
  id: string;
  category: string;
  status: string;
  createdAt: string;
  raisedBy: { name: string; phone: string };
  assignedAdmin: { id: string; username: string } | null;
};

function SupportQueue() {
  const router = useRouter();
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiRequest<SupportTicket[]>('/v1/admin/support-tickets');
    setItems(data);
  }, []);

  useEffect(() => {
    load()
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [load]);

  // Global broadcast (no room join needed) — any ticket created/claimed/replied-to
  // refreshes the queue live, e.g. another admin's "เปิด Ticket" click updates this
  // list immediately instead of waiting for a manual refresh.
  useEffect(() => {
    const socket = getSocket();
    const onChanged = () => load().catch(() => {});
    socket.on('support-ticket-changed', onChanged);
    return () => {
      socket.off('support-ticket-changed', onChanged);
    };
  }, [load]);

  // เปิด/รับเรื่อง — action ที่ต้องกดชัดเจน แยกจากแค่คลิกเข้าไปดู detail (ซึ่งแค่ mark
  // read เฉยๆ ไม่ claim) PATCH body ว่างก็ claim ได้เพราะ backend ตั้ง assignedAdminId
  // ให้ทุกครั้งที่ ticket ยังไม่มีคนรับ ไม่สนว่ามี message/status ส่งมาด้วยหรือไม่
  const onOpen = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpeningId(id);
    try {
      await apiRequest(`/v1/admin/support-tickets/${id}`, { method: 'PATCH', body: {} });
      await load();
      router.push(`/support/${id}`);
    } catch {
      setOpeningId(null);
    }
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-foreground">Support Ticket</h1>
      <ListContainer loading={loading} error={error} isEmpty={items.length === 0}>
        {items.map((item) => {
          const meta = supportStatusMeta(item.status);
          return (
            <ListRow
              key={item.id}
              href={`/support/${item.id}`}
              title={SUPPORT_CATEGORY_TH[item.category] ?? item.category}
              meta={`${item.raisedBy.name} (${item.raisedBy.phone}) · ${new Date(item.createdAt).toLocaleDateString('th-TH')} · ${item.assignedAdmin ? `รับเรื่องโดย ${item.assignedAdmin.username}` : 'ยังไม่มีคนรับ'}`}
              right={
                <div className="flex items-center gap-2">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  {!item.assignedAdmin && (
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      loading={openingId === item.id}
                      onClick={(e) => onOpen(item.id, e)}
                    >
                      เปิด Ticket
                    </Button>
                  )}
                </div>
              }
            />
          );
        })}
      </ListContainer>
    </div>
  );
}

export default function SupportPage() {
  return (
    <AdminShell>
      <SupportQueue />
    </AdminShell>
  );
}
