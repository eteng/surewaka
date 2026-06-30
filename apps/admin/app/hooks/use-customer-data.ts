import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CustomerListItem, PaginationMeta } from '@surewaka/shared';
import type { CustomerParams } from './use-customer-params';

type UseCustomerDataResult = {
  data: CustomerListItem[];
  meta: PaginationMeta | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function buildQueryString(params: Partial<CustomerParams>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }

  return searchParams.toString();
}

export function useCustomerData(params: Partial<CustomerParams>): UseCustomerDataResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<CustomerListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const paramsKey = JSON.stringify(params);

  const fetchData = useCallback(async () => {
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

      const queryString = buildQueryString(params);
      const url = `${API_URL}/api/v1/admin/customers${queryString ? `?${queryString}` : ''}`;

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
        setData([]);
        setMeta(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setData(body.data ?? []);
      setMeta(body.meta ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setData([]);
      setMeta(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  useEffect(() => {
    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { data, meta, isLoading, error, refetch };
}
