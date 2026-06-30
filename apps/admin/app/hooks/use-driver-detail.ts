import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { DriverDetail } from '@surewaka/shared';

type UseDriverDetailResult = {
  driver: DriverDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useDriverDetail(driverId: string): UseDriverDetailResult {
  const { getToken } = useAuth();
  const [driver, setDriver] = useState<DriverDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!driverId) {
      setIsLoading(false);
      return;
    }

    // Cancel any in-flight request
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

      const response = await fetch(`${API_URL}/api/v1/admin/drivers/${driverId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
          body?.error?.message || `Request failed with status ${response.status}`;
        setError(message);
        setDriver(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setDriver(body.data ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Request was cancelled, don't update state
      }
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setDriver(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [driverId, getToken]);

  useEffect(() => {
    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { driver, isLoading, error, refetch };
}
