import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export type FinanceSummary = {
  period: { from: string; to: string };
  revenue: { commission: number; withdrawal_fees: number; total: number };
  expenses: {
    operational: { paystack_transfer: number; paystack_collection: number; total: number };
    infrastructure: { vercel: number; fly: number; neon: number; clerk: number; ably: number; total: number };
    total: number;
  };
  summary: {
    revenue: number;
    operational_expenses: number;
    gross_profit: number;
    total_expenses: number;
    net_profit: number;
    margin_percent: number | null;
  };
};

export type TrendItem = {
  period: string;
  revenue: number;
  operational_expenses: number;
  infrastructure_expenses: number;
  gross_profit: number;
  net_profit: number;
};

export type LedgerRow = {
  id: string;
  category: string;
  type: string;
  amountKobo: number;
  sourceId: string;
  sourceType: string;
  occurredAt: string;
};

export type CostRow = {
  provider: string;
  amount_usd: number;
  usd_to_ngn_rate: number;
  amount_kobo: number;
  snapshot_date: string;
  estimated: boolean;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function useFinanceSummary(from: string, to: string) {
  const { getToken } = useAuth();
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${API}/api/v1/admin/finance/summary?from=${from}&to=${to}`, { headers: authHeaders(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `${res.status}`);
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load summary');
    } finally {
      setIsLoading(false);
    }
  }, [from, to, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, isLoading, error, refetch: fetch_ };
}

export function useFinanceTrend(months = 6) {
  const { getToken } = useAuth();
  const [data, setData] = useState<TrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${API}/api/v1/admin/finance/trend?months=${months}`, { headers: authHeaders(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `${res.status}`);
      setData(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trend');
    } finally {
      setIsLoading(false);
    }
  }, [months, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, isLoading, error };
}

export function useFinanceLedger(from: string, to: string, category?: string, offset = 0, limit = 50) {
  const { getToken } = useAuth();
  const [data, setData] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const params = new URLSearchParams({ from, to, limit: String(limit), offset: String(offset) });
      if (category) params.set('category', category);
      const res = await fetch(`${API}/api/v1/admin/finance/ledger?${params}`, { headers: authHeaders(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `${res.status}`);
      setData(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger');
    } finally {
      setIsLoading(false);
    }
  }, [from, to, category, offset, limit, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, total, isLoading, error, refetch: fetch_ };
}
