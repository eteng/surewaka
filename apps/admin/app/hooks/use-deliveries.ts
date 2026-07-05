import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { DeliveryListItem, DeliveryStatus, PaginationMeta, TabCounts } from '@surewaka/shared';

type DeliveryTab = 'all' | 'requests' | 'active' | 'completed';
type SortBy = 'createdAt' | 'status' | 'customerName' | 'price';
type SortDir = 'asc' | 'desc';

export type DeliveriesParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: DeliveryStatus;
  tab?: DeliveryTab;
  sortBy?: SortBy;
  sortDir?: SortDir;
};

type DeliveriesMeta = PaginationMeta & {
  tabCounts: TabCounts;
};

export type UseDeliveriesResult = {
  data: DeliveryListItem[];
  meta: DeliveriesMeta | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function buildQueryString(params: DeliveriesParams): string {
  const searchParams = new URLSearchParams();

  if (params.page !== undefined && params.page !== 1) {
    searchParams.set('page', String(params.page));
  }

  if (params.pageSize !== undefined && params.pageSize !== 20) {
    searchParams.set('pageSize', String(params.pageSize));
  }

  if (params.search) {
    searchParams.set('search', params.search);
  }

  if (params.status) {
    searchParams.set('status', params.status);
  }

  if (params.tab && params.tab !== 'all') {
    searchParams.set('tab', params.tab);
  }

  if (params.sortBy && params.sortBy !== 'createdAt') {
    searchParams.set('sortBy', params.sortBy);
  }

  if (params.sortDir && params.sortDir !== 'desc') {
    searchParams.set('sortDir', params.sortDir);
  }

  return searchParams.toString();
}

export function useDeliveries(params: DeliveriesParams = {}): UseDeliveriesResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<DeliveryListItem[]>([]);
  const [meta, setMeta] = useState<DeliveriesMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const paramsKey = JSON.stringify(params);

  const fetchData = useCallback(async () => {
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

      const queryString = buildQueryString(params);
      const url = `${API_URL}/api/v1/admin/deliveries${queryString ? `?${queryString}` : ''}`;

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
        return; // Request was cancelled, don't update state
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
