'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ticket } from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/FormField';

export default function LoginPage() {
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setSession } = useAuth();
  const router = useRouter();

  // Read straight off location instead of useSearchParams() — that hook forces this
  // page under a Suspense boundary, and the flag is only needed after mount anyway.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('expired') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the redirect flag
      setError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
  }, []);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ devCode?: string }>('/v1/admin/auth/login', {
        method: 'POST',
        body: { username, password },
        auth: false,
      });
      setDevCode(data.devCode ?? null);
      if (data.devCode) setCode(data.devCode);
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? 'Username หรือ Password ไม่ถูกต้อง' : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiRequest<{ access_token: string; admin: { id: string; username: string; role: 'admin' | 'super_admin' } }>(
        '/v1/admin/auth/otp/verify',
        { method: 'POST', body: { username, code }, auth: false }
      );
      setSession(data.access_token, data.admin);
      // Same landing rule as app/page.tsx: a SuperAdmin's home is the platform overview,
      // an Admin's is the approval queue. This used to send everyone to /vendors, so a
      // SuperAdmin only ever reached the dashboard by clicking the nav.
      router.replace(data.admin.role === 'super_admin' ? '/dashboard' : '/vendors');
    } catch (err) {
      setError(err instanceof ApiError ? 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ' : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <Ticket className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">E-ticket</h1>
            <p className="text-xs text-text-muted">เข้าสู่ระบบ Admin Console</p>
          </div>
        </div>

        {error && <div className="mb-4 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>}

        {step === 'credentials' ? (
          <form onSubmit={onLogin} className="space-y-4">
            <TextInput label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <TextInput
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <p className="text-sm text-text-muted">กรอกรหัส OTP ที่ส่งไปยังเบอร์โทรที่ผูกกับบัญชีนี้</p>
            {devCode && <p className="text-xs text-primary">(dev only — กรอกให้อัตโนมัติแล้ว: {devCode})</p>}
            <TextInput
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="text-center text-lg tracking-widest"
            />
            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'กำลังยืนยัน...' : 'ยืนยัน'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
