import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';

type NotificationItem = { id: string; readAt: string | null };

export function useUnreadNotifications() {
  const { isLoggedIn } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) {
      setUnreadCount(0);
      return;
    }
    try {
      const data = await apiRequest<NotificationItem[]>('/v1/notifications');
      setUnreadCount(data.filter((n) => !n.readAt).length);
    } catch {
      // best-effort — badge just skips this refresh cycle
    }
  }, [isLoggedIn]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { unreadCount, refresh };
}
