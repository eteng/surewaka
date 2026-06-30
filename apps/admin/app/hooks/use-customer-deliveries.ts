import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CustomerDeliveryItem } from '@surewaka/shared';

type PaginationMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type UseCustomerDeliveriesResult = {
  deliveries: CustomerDeliveryItem[];
  meta: PaginationMeta | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useCustomerDeliveries(
  customerId: string,
  page: number,
  pageSize: number,
): UseCustomerDeliveriesResult {
  const { getToken } = useAuth();
  const [deliveries, setDeliveries] = useState<CustomerDeliveryItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!customerId) {
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

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      const response = await fetch(
        `${API_URL}/api/v1/admin/customers/${customerId}/deliveries?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
          body?.error?.message || `Request failed with status ${response.status}`;
        setError(message);
        setDeliveries([]);
        setMeta(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setDeliveries(body.data ?? []);
      setMeta(body.meta ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Request was cancelled, don't update state
      }
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setDeliveries([]);
      setMeta(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [customerId, page, pageSize, getToken]);

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

  return { deliveries, meta, isLoading, error, refetch };
}
