'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '../../../../lib/AdminShell';
import { apiRequest, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/AuthContext';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { TextInput } from '../../../../components/ui/FormField';
import { ErrorState, LoadingState } from '../../../../components/ui/States';

type AdminAccount = { id: string; username: string; role: string; status: string; createdAt: string };

function AdminPasswordBody() {
  const { admin } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [target, setTarget] = useState<AdminAccount | null | undefined>(undefined); // undefined = loading
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const admins = await apiRequest<AdminAccount[]>('/v1/superadmin/admins');
    setTarget(admins.find((a) => a.id === params.id) ?? null);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load().catch(() => setTarget(null));
  }, [load]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัว');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest(`/v1/superadmin/admins/${params.id}/password`, {
        method: 'PATCH',
        body: { newPassword },
      });
      router.push('/admins');
    } catch (err) {
      setError(err instanceof ApiError ? 'เปลี่ยนรหัสผ่านไม่สำเร็จ' : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  if (admin?.role !== 'super_admin') {
    return <ErrorState message="หน้านี้สำหรับ SuperAdmin เท่านั้น" />;
  }

  if (target === undefined) return <LoadingState />;
  if (target === null || target.role === 'super_admin') {
    return <ErrorState message="ไม่พบบัญชีนี้ หรือไม่สามารถเปลี่ยนรหัสผ่านของ SuperAdmin คนอื่นได้" />;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold text-foreground">เปลี่ยนรหัสผ่าน: {target.username}</h1>

      <Card>
        {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
        <form onSubmit={onSubmit} className="space-y-3">
          <TextInput
            label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <TextInput
            label="ยืนยันรหัสผ่านใหม่"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <Button type="submit" loading={submitting}>
            บันทึกรหัสผ่านใหม่
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function AdminPasswordPage() {
  return (
    <AdminShell>
      <AdminPasswordBody />
    </AdminShell>
  );
}
