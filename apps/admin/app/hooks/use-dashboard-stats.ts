import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';

export type DashboardStats = {
  pendingApplications: number;
  pendingApplicationsDelta: number;
  approvedCarriers: number;
  approvedCarriersDelta: number;
  totalDeliveries: number;
  deliveriesDelta: number;
  waitlistTotal: number;
  waitlistDelta: number;
};

type UseDashboardStatsResult = {
  stats: DashboardStats | null;
  isLoading: boolean;
  error: string | null;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useDashboardStats(): UseDashboardStatsResult {
  const { getToken } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchStats() {
      setIsLoading(true);
      setError(null);

      try {
        const accessToken = await getToken();

        if (!accessToken) {
          setError('Not authenticated');
          setIsLoading(false);
          return;
        }

        const response = await fetch(`${API_URL}/api/v1/admin/dashboard/stats`, {
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
          setStats(null);
          setIsLoading(false);
          return;
        }

        const body = await response.json();
        setStats(body.data ?? null);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
        setStats(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchStats();

    return () => controller.abort();
  }, []);

  return { stats, isLoading, error };
}
