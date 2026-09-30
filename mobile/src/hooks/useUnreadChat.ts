import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useMode } from '../context/ModeContext';

const POLL_INTERVAL_MS = 30_000;

/**
 * Unread chat count for whichever side the current mode puts the user on —
 * their own rooms as a customer, or the shop's inbox in vendor/staff mode.
 */
export function useUnreadChat() {
  const { isLoggedIn } = useAuth();
  const { mode, vendorShopId, staffShopId } = useMode();
  const shopId = mode === 'vendor' ? vendorShopId : mode === 'staff' ? staffShopId : null;
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) {
      setUnreadCount(0);
      return;
    }
    try {
      const path = shopId ? `/v1/shops/${shopId}/conversations/unread-count` : '/v1/conversations/unread-count';
      const data = await apiRequest<{ unread_count: number }>(path);
      setUnreadCount(data.unread_count);
    } catch {
      // best-effort — the badge just skips this cycle
    }
  }, [isLoggedIn, shopId]);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [refresh]);

  return { unreadCount, refresh };
}
