'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, setToken, clearSession, PROFILE_KEY, SESSION_EXPIRED_EVENT } from './api';

type Admin = { id: string; username: string; role: 'admin' | 'super_admin' };

type AuthContextValue = {
  isLoading: boolean;
  admin: Admin | null;
  setSession: (token: string, admin: Admin) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const router = useRouter();

  useEffect(() => {
    // No "whoami" endpoint on the admin API yet — the JWT payload we get back
    // at login time is the only source of admin identity, so we persist it
    // alongside the token rather than re-fetching it.
    const token = getToken();
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(PROFILE_KEY) : null;
    if (token && stored) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage on mount
        setAdmin(JSON.parse(stored));
      } catch {
        // Corrupted profile blob — treat it as no session rather than crashing on mount.
        clearSession();
      }
    }
    setIsLoading(false);
  }, []);

  // A token can go stale while the tab is open (8h expiry, or the DB being wiped and
  // reseeded in dev). apiRequest clears storage and fires this; we mirror it in state
  // so AdminShell's guard sends the tab to /login.
  useEffect(() => {
    const onExpired = () => {
      setAdmin(null);
      router.replace('/login?expired=1');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  const setSession = useCallback((token: string, adminData: Admin) => {
    setToken(token);
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(adminData));
    setAdmin(adminData);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setAdmin(null);
    router.replace('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ isLoading, admin, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
