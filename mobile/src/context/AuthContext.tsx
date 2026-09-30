import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiRequest, getToken, setToken } from '../api/client';
import { onAccountSuspended } from '../api/accountEvents';

type Me = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  avatar_url: string | null;
  // active | suspended — GET /v1/me stays reachable while suspended (it's the appeal
  // channel's entry point), so a suspension shows up as data here rather than as a
  // thrown error. RootNavigator branches the whole app on this.
  status: string;
  suspended_reason: string | null;
  suspended_at: string | null;
  roles: {
    vendorOwner: { vendorId: string; vendorName: string; verificationStatus: string; hasShop: boolean }[];
    shopStaff: { shopId: string; role: string }[];
  };
};

type AuthContextValue = {
  isLoading: boolean;
  isLoggedIn: boolean;
  me: Me | null;
  // POST /v1/auth/otp/verify already returns a ready-to-use access_token, so this
  // just stores it and refreshes `me`.
  loginWithToken: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const data = await apiRequest<Me>('/v1/me');
      setMe(data);
    } catch {
      setMe(null);
      await setToken(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) await refreshMe();
      setIsLoading(false);
    })();
  }, [refreshMe]);

  // A ban revealed mid-session (any API call returning 403 ACCOUNT_SUSPENDED) re-checks
  // `me` right away instead of waiting for the next foreground transition — see
  // RootNavigator's suspended gate and api/accountEvents.ts.
  useEffect(() => {
    onAccountSuspended(() => {
      refreshMe();
    });
  }, [refreshMe]);

  const loginWithToken = useCallback(async (accessToken: string) => {
    await setToken(accessToken);
    await refreshMe();
  }, [refreshMe]);

  const logout = useCallback(async () => {
    await setToken(null);
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isLoading, isLoggedIn: Boolean(me), me, loginWithToken, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
