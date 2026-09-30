'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import AdminShell from '../../lib/AdminShell';
import { apiRequest, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextInput, Select } from '../../components/ui/FormField';
import { ErrorState } from '../../components/ui/States';
import { useConfirm } from '../../components/ui/ConfirmDialog';

type AdminAccount = { id: string; username: string; role: string; status: string; createdAt: string };

function AdminsBody() {
  const { admin } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [form, setForm] = useState({ username: '', password: '', phone: '', role: 'admin' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const data = await apiRequest<AdminAccount[]>('/v1/superadmin/admins');
    setAdmins(data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setError('โหลดรายชื่อ Admin ไม่สำเร็จ'));
  }, [load]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/v1/superadmin/admins', { method: 'POST', body: form });
      setForm({ username: '', password: '', phone: '', role: 'admin' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'สร้างไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const onDisable = async (id: string) => {
    const ok = await confirm({ title: 'ยืนยันปิดใช้งานบัญชีนี้?', danger: true, confirmLabel: 'ปิดใช้งาน' });
    if (!ok) return;
    setError(null);
    try {
      await apiRequest(`/v1/superadmin/admins/${id}/disable`, { method: 'PATCH' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ปิดใช้งานบัญชีไม่สำเร็จ');
    }
  };

  if (admin?.role !== 'super_admin') {
    return <ErrorState message="หน้านี้สำหรับ SuperAdmin เท่านั้น" />;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold text-foreground">จัดการบัญชี Admin</h1>

      <div className="mb-6 divide-y divide-border rounded-lg border border-border bg-surface">
        {admins.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium text-foreground">{a.username}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                {a.role === 'super_admin' ? 'SuperAdmin' : 'Admin'}
                <Badge variant={a.status === 'active' ? 'success' : 'neutral'}>
                  {a.status === 'active' ? 'ใช้งานอยู่' : 'ปิดใช้งานแล้ว'}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {a.role !== 'super_admin' && (
                <Link href={`/admins/${a.id}/password`} className="text-sm text-primary hover:underline">
                  เปลี่ยนรหัสผ่าน
                </Link>
              )}
              {a.status === 'active' && a.id !== admin.id && (
                <button onClick={() => onDisable(a.id)} className="text-sm text-danger hover:underline">
                  ปิดใช้งาน
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">สร้างบัญชี Admin ใหม่</h2>
        {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
        <form onSubmit={onCreate} className="space-y-3">
          <TextInput
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <TextInput
            type="password"
            placeholder="Password (อย่างน้อย 8 ตัว)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <TextInput
            placeholder="เบอร์โทร (สำหรับ OTP)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="admin">Admin</option>
            <option value="super_admin">SuperAdmin</option>
          </Select>
          <Button type="submit" loading={submitting}>
            สร้างบัญชี
          </Button>
        </form>
      </Card>
      {dialog}
    </div>
  );
}

export default function AdminsPage() {
  return (
    <AdminShell>
      <AdminsBody />
    </AdminShell>
  );
}
