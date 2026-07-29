import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { CHANNELS, EVENTS, createAblyProvider, type Unsubscribe } from '@surewaka/realtime';
import type { NotificationData, PaginationMeta } from '@surewaka/shared';
import { useProfile } from '~/hooks/use-profile';

type FetchOptions = {
  page?: number;
  pageSize?: number;
  type?: string;
  isRead?: boolean;
};

type NotificationsContextValue = {
  unreadCount: number;
  notifications: NotificationData[];
  isLoading: boolean;
  error: string | null;
  meta: PaginationMeta | null;
  fetchNotifications: (options?: FetchOptions) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refetchUnreadCount: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Realtime (Ably) delivers unread-count updates as they happen. This is only
// a safety net in case a connection drop is missed by the reconnect logic.
const FALLBACK_POLL_INTERVAL = 5 * 60_000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { profile } = useProfile();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const refetchUnreadCount = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const accessToken = await getToken();
      if (!accessToken) return;

      const response = await fetch(`${API_URL}/api/v1/notifications/unread-count`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return;

      const body = await response.json();
      setUnreadCount(body.data?.count ?? 0);
    } catch {
      // Silently fail for background refreshes — don't show error for these
    }
  }, [isLoaded, isSignedIn, getToken]);

  const fetchNotifications = useCallback(async (options?: FetchOptions) => {
    if (!isLoaded || !isSignedIn) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getToken();

      if (!accessToken) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const searchParams = new URLSearchParams();
      if (options?.page) searchParams.set('page', String(options.page));
      if (options?.pageSize) searchParams.set('pageSize', String(options.pageSize));
      if (options?.type) searchParams.set('type', options.type);
      if (options?.isRead !== undefined) searchParams.set('isRead', String(options.isRead));

      const queryString = searchParams.toString();
      const url = `${API_URL}/api/v1/notifications${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || `Request failed with status ${response.status}`;
        setError(message);
        setNotifications([]);
        setMeta(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setNotifications(body.data ?? []);
      setMeta(body.meta ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setNotifications([]);
      setMeta(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [isLoaded, isSignedIn, getToken]);

  const markAsRead = useCallback(async (id: string) => {
    // Optimistic update: decrement count and set isRead locally
    const previousCount = unreadCount;
    const previousNotifications = notifications;

    const notification = notifications.find((n) => n.id === id);
    if (notification && !notification.isRead) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );

    try {
      const accessToken = await getToken();
      if (!accessToken) {
        setUnreadCount(previousCount);
        setNotifications(previousNotifications);
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/notifications/${id}/read`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        setUnreadCount(previousCount);
        setNotifications(previousNotifications);
      }
    } catch {
      setUnreadCount(previousCount);
      setNotifications(previousNotifications);
    }
  }, [getToken, unreadCount, notifications]);

  const markAllAsRead = useCallback(async () => {
    const previousCount = unreadCount;
    const previousNotifications = notifications;

    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));

    try {
      const accessToken = await getToken();
      if (!accessToken) {
        setUnreadCount(previousCount);
        setNotifications(previousNotifications);
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/notifications/mark-all-read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        setUnreadCount(previousCount);
        setNotifications(previousNotifications);
      }
    } catch {
      setUnreadCount(previousCount);
      setNotifications(previousNotifications);
    }
  }, [getToken, unreadCount, notifications]);

  // Initial load + long-interval fallback poll (visibility-aware, same as before).
  // Real-time updates arrive via the Ably subscription below.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    refetchUnreadCount();
    let interval: ReturnType<typeof setInterval> | null = setInterval(refetchUnreadCount, FALLBACK_POLL_INTERVAL);

    function handleVisibilityChange() {
      if (document.hidden) {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      } else {
        refetchUnreadCount();
        if (!interval) {
          interval = setInterval(refetchUnreadCount, FALLBACK_POLL_INTERVAL);
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoaded, isSignedIn, refetchUnreadCount]);

  // Realtime subscription — refreshes unread count the moment a notification
  // is created, instead of waiting for the fallback poll.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !profile?.id) return;

    const provider = createAblyProvider();
    const unsub: Unsubscribe = provider.subscribe(
      CHANNELS.adminNotifications(profile.id),
      EVENTS.notificationCreated,
      () => {
        refetchUnreadCount();
      },
    );

    return () => {
      unsub();
      provider.close();
    };
  }, [isLoaded, isSignedIn, profile?.id, refetchUnreadCount]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <NotificationsContext.Provider
      value={{
        unreadCount,
        notifications,
        isLoading,
        error,
        meta,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        refetchUnreadCount,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotificationsContext must be used within a NotificationsProvider');
  }
  return ctx;
}
