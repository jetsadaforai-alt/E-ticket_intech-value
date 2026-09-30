'use client';

import React, { useState } from 'react';
import AdminShell from '../../lib/AdminShell';
import { apiRequest, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/FormField';

function ProfileBody() {
  const { admin } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

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
      await apiRequest('/v1/admin/me/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === 'INVALID_CURRENT_PASSWORD'
          ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
          : 'เปลี่ยนรหัสผ่านไม่สำเร็จ'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold text-foreground">แก้ไขโปรไฟล์</h1>

      <Card>
        <div className="mb-4">
          <div className="text-sm font-semibold text-foreground">{admin?.username}</div>
          <div className="text-xs text-text-muted">{admin?.role === 'super_admin' ? 'SuperAdmin' : 'Admin'}</div>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-foreground">เปลี่ยนรหัสผ่าน</h2>
        {error && <div className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}
        {success && (
          <div className="mb-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success">เปลี่ยนรหัสผ่านสำเร็จ</div>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          <TextInput
            label="รหัสผ่านปัจจุบัน"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
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

export default function ProfilePage() {
  return (
    <AdminShell>
      <ProfileBody />
    </AdminShell>
  );
}
