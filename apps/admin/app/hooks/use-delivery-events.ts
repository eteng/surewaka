import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { DeliveryEventWithActor } from '@surewaka/shared';

type UseDeliveryEventsResult = {
  data: DeliveryEventWithActor[];
  loading: boolean;
  error: string | null;
  prepend: (event: DeliveryEventWithActor) => void;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useDeliveryEvents(deliveryId: string | null | undefined): UseDeliveryEventsResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<DeliveryEventWithActor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!deliveryId) {
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const accessToken = await getToken();

      if (!accessToken) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/admin/deliveries/${deliveryId}/events`, {
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
        setLoading(false);
        return;
      }

      const body = await response.json();
      setData(body.data ?? []);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setData([]);
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setLoading(false);
      }
    }
  }, [deliveryId, getToken]);

  useEffect(() => {
    fetchData();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchData]);

  // Prepend a synthetic event optimistically (called by realtime handler)
  const prepend = useCallback((event: DeliveryEventWithActor) => {
    setData((prev) => [event, ...prev]);
  }, []);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, prepend, refetch };
}
