import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { NotificationData, PaginationMeta } from '@surewaka/shared';

type FetchOptions = {
  page?: number;
  pageSize?: number;
  type?: string;
  isRead?: boolean;
};

type UseNotificationsReturn = {
  // State
  unreadCount: number;
  notifications: NotificationData[];
  isLoading: boolean;
  error: string | null;

  // Pagination (for full page)
  meta: PaginationMeta | null;

  // Actions
  fetchNotifications: (options?: FetchOptions) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refetchUnreadCount: () => Promise<void>;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL = 30_000; // 30 seconds

export function useNotifications(): UseNotificationsReturn {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      // Silently fail for background polls — don't show error for polling failures
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
        // Revert on auth failure
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
        // Revert on failure
        setUnreadCount(previousCount);
        setNotifications(previousNotifications);
      }
    } catch {
      // Revert on failure
      setUnreadCount(previousCount);
      setNotifications(previousNotifications);
    }
  }, [getToken, unreadCount, notifications]);

  const markAllAsRead = useCallback(async () => {
    // Optimistic update: set count to 0 and mark all read locally
    const previousCount = unreadCount;
    const previousNotifications = notifications;

    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));

    try {
      const accessToken = await getToken();
      if (!accessToken) {
        // Revert on auth failure
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
        // Revert on failure
        setUnreadCount(previousCount);
        setNotifications(previousNotifications);
      }
    } catch {
      // Revert on failure
      setUnreadCount(previousCount);
      setNotifications(previousNotifications);
    }
  }, [getToken, unreadCount, notifications]);

  // Polling with tab visibility awareness
  useEffect(() => {
    function startPolling() {
      refetchUnreadCount();
      intervalRef.current = setInterval(refetchUnreadCount, POLL_INTERVAL);
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refetchUnreadCount]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    unreadCount,
    notifications,
    isLoading,
    error,
    meta,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    refetchUnreadCount,
  };
}
