import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import type {
  OverviewKpis,
  DeliveryPerformanceData,
  DriverPerformanceRow,
  CarrierPerformanceData,
  CustomerExperienceData,
  RootCauseData,
} from '@surewaka/shared';

export type AnalyticsParams = {
  period: 'today' | 'week' | 'month' | 'custom';
  from?: string;
  to?: string;
};

export type RootCauseFilters = {
  zone?: string;
  driverId?: string;
  carrierId?: string;
  legType?: string;
  timeOfDay?: string;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function buildQuery(params: AnalyticsParams & Partial<RootCauseFilters>): string {
  const q = new URLSearchParams();
  if (params.period) q.set('period', params.period);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.zone) q.set('zone', params.zone);
  if (params.driverId) q.set('driverId', params.driverId);
  if (params.carrierId) q.set('carrierId', params.carrierId);
  if (params.legType) q.set('legType', params.legType);
  if (params.timeOfDay) q.set('timeOfDay', params.timeOfDay);
  return q.toString();
}

function useAnalyticsEndpoint<T>(
  endpoint: string,
  params: AnalyticsParams & Partial<RootCauseFilters>,
): { data: T | null; isLoading: boolean; error: string | null } {
  const { getToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = buildQuery(params);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          setError('Not authenticated');
          setIsLoading(false);
          return;
        }
        const res = await fetch(`${API_URL}/api/v1/admin/analytics/${endpoint}?${queryString}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? `Request failed: ${res.status}`);
          setData(null);
          setIsLoading(false);
          return;
        }
        const body = await res.json();
        setData(body.data ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Unexpected error');
        setData(null);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    fetchData();
    return () => controller.abort();
  }, [endpoint, queryString]);

  return { data, isLoading, error };
}

export function useAnalyticsOverview(params: AnalyticsParams) {
  return useAnalyticsEndpoint<OverviewKpis>('overview', params);
}

export function useAnalyticsDeliveryPerformance(params: AnalyticsParams) {
  return useAnalyticsEndpoint<DeliveryPerformanceData>('delivery-performance', params);
}

export function useAnalyticsDriverPerformance(params: AnalyticsParams) {
  return useAnalyticsEndpoint<DriverPerformanceRow[]>('driver-performance', params);
}

export function useAnalyticsCarrierPerformance(params: AnalyticsParams) {
  return useAnalyticsEndpoint<CarrierPerformanceData>('carrier-performance', params);
}

export function useAnalyticsCustomerExperience(params: AnalyticsParams) {
  return useAnalyticsEndpoint<CustomerExperienceData>('customer-experience', params);
}

export function useAnalyticsRootCause(params: AnalyticsParams & RootCauseFilters) {
  return useAnalyticsEndpoint<RootCauseData>('root-cause', params);
}
