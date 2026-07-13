import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'reversed';

export type PayoutRow = {
  id: string;
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  status: PayoutStatus;
  failureReason: string | null;
  paystackTransferCode: string | null;
  paystackRecipientCode: string | null;
  createdAt: string;
  processedAt: string | null;
  userId: string;
  userName: string;
  userEmail: string;
};

type PayoutMeta = {
  total: number;
  limit: number;
  offset: number;
};

type UsePayoutsResult = {
  data: PayoutRow[];
  meta: PayoutMeta | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function usePayouts(status: PayoutStatus | 'all', offset: number, limit = 50): UsePayoutsResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<PayoutRow[]>([]);
  const [meta, setMeta] = useState<PayoutMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`${API_URL}/api/v1/admin/payouts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Request failed (${res.status})`);
        setData([]);
        setMeta(null);
        setIsLoading(false);
        return;
      }

      const body = await res.json();
      setData(body.data ?? []);
      setMeta(body.meta ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setData([]);
      setMeta(null);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offset, limit]);

  useEffect(() => {
    fetchData();
    return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offset, limit]);

  return { data, meta, isLoading, error, refetch: fetchData };
}
