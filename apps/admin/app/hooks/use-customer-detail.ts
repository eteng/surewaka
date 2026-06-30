import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CustomerDetail } from '@surewaka/shared';

type UseCustomerDetailResult = {
  customer: CustomerDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useCustomerDetail(customerId: string): UseCustomerDetailResult {
  const { getToken } = useAuth();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
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

      const response = await fetch(`${API_URL}/api/v1/admin/customers/${customerId}`, {
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
        setCustomer(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setCustomer(body.data ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Request was cancelled, don't update state
      }
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setCustomer(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [customerId, getToken]);

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

  return { customer, isLoading, error, refetch };
}
