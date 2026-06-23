import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CarrierApplicationListItem, CarrierApplicationListQuery, CarrierListItem } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type ApplicationsResult = {
  data: CarrierApplicationListItem[];
  meta: { total: number; page: number; pageSize: number; totalPages: number } | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

type CarriersResult = {
  data: CarrierListItem[];
  meta: { total: number; page: number; pageSize: number; totalPages: number } | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useCarrierApplications(params: Partial<CarrierApplicationListQuery>): ApplicationsResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<CarrierApplicationListItem[]>([]);
  const [meta, setMeta] = useState<ApplicationsResult['meta']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const token = await getToken();
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString();

      const res = await fetch(`${API_URL}/api/v1/admin/carriers/applications?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) return;

      if (!res.ok) {
        setError('Failed to load applications');
        setIsLoading(false);
        return;
      }

      const json = await res.json();
      setData(json.data ?? []);
      setMeta(json.meta ?? null);
      setIsLoading(false);
    })().catch((err) => {
      if (!cancelled) { setError(String(err)); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [params.page, params.pageSize, params.search, params.status, params.sortBy, params.sortDir, tick]);

  return { data, meta, isLoading, error, refetch };
}

export function useCarriers(params: { page?: number; pageSize?: number; search?: string; isActive?: boolean }): CarriersResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<CarrierListItem[]>([]);
  const [meta, setMeta] = useState<CarriersResult['meta']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const token = await getToken();
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString();

      const res = await fetch(`${API_URL}/api/v1/admin/carriers?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) return;
      if (!res.ok) { setError('Failed to load carriers'); setIsLoading(false); return; }

      const json = await res.json();
      setData(json.data ?? []);
      setMeta(json.meta ?? null);
      setIsLoading(false);
    })().catch((err) => {
      if (!cancelled) { setError(String(err)); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [params.page, params.pageSize, params.search, params.isActive, tick]);

  return { data, meta, isLoading, error, refetch };
}
