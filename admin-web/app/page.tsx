'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/AuthContext';
import { LoadingState } from '../components/ui/States';

export default function RootPage() {
  const { isLoading, admin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!admin) return router.replace('/login');
    router.replace(admin.role === 'super_admin' ? '/dashboard' : '/vendors');
  }, [isLoading, admin, router]);

  return (
    <div className="flex flex-1 min-h-screen items-center justify-center bg-background">
      <LoadingState />
    </div>
  );
}
