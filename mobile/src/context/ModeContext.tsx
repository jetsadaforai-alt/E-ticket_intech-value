import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { loadStoredMode, storeMode, type AppMode } from '../storage/appMode';

export type { AppMode };

type ModeContextValue = {
  /** true once the persisted mode has been read back and validated against the current roles */
  isModeReady: boolean;
  mode: AppMode;
  /** shop the user manages (vendor mode) — can be a different shop from staffShopId */
  vendorShopId: string | null;
  /** shop the user works at as staff (staff mode) */
  staffShopId: string | null;
  canVendor: boolean;
  canStaff: boolean;
  /** silently ignored when the current roles don't allow the requested mode */
  setMode: (next: AppMode) => void;
};

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const { me, isLoading, refreshMe } = useAuth();
  const [mode, setModeState] = useState<AppMode>('customer');
  const [isModeReady, setIsModeReady] = useState(false);

  // A user can be manager of their own shop AND staff at someone else's — two
  // different shops, so they're tracked separately rather than as one "active" id.
  const vendorShopId = me?.roles.shopStaff.find((s) => s.role === 'manager')?.shopId ?? null;
  const staffShopId = me?.roles.shopStaff.find((s) => s.role === 'staff')?.shopId ?? null;
  const canVendor = vendorShopId !== null;
  const canStaff = staffShopId !== null;

  const isAllowed = useCallback(
    (m: AppMode) => (m === 'customer' ? true : m === 'vendor' ? canVendor : canStaff),
    [canVendor, canStaff]
  );

  // Hydrate once auth has settled, so the stored mode is validated against roles
  // we actually know — validating while `me` is still null would always fail.
  useEffect(() => {
    if (isLoading || isModeReady) return;
    (async () => {
      const stored = await loadStoredMode();
      setModeState(stored && isAllowed(stored) ? stored : 'customer');
      setIsModeReady(true);
    })();
  }, [isLoading, isModeReady, isAllowed]);

  // Roles can change under the user (staff assignment revoked, logout) — drop back
  // to customer mode rather than leaving them on a screen they no longer may see.
  useEffect(() => {
    if (!isModeReady) return;
    if (!me || !isAllowed(mode)) {
      setModeState('customer');
      storeMode(null);
    }
  }, [me, mode, isAllowed, isModeReady]);

  // Nothing else polls /v1/me, so without this a revoked staff member would keep
  // staff mode until some screen happened to refresh. Same AppState gating as
  // NotificationCenterScreen — only while the app is actually in the foreground.
  const refreshRef = useRef(refreshMe);
  refreshRef.current = refreshMe;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshRef.current();
    });
    return () => sub.remove();
  }, []);

  const setMode = useCallback(
    (next: AppMode) => {
      if (!isAllowed(next)) return;
      setModeState(next);
      storeMode(next === 'customer' ? null : next);
    },
    [isAllowed]
  );

  const value = useMemo(
    () => ({ isModeReady, mode, vendorShopId, staffShopId, canVendor, canStaff, setMode }),
    [isModeReady, mode, vendorShopId, staffShopId, canVendor, canStaff, setMode]
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used within ModeProvider');
  return ctx;
}
