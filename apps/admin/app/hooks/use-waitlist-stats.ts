import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';

type WaitlistStats = {
  total: number;
  bySender: number;
  byBusiness: number;
  byDriver: number;
  last7Days: number;
};

type UseWaitlistStatsResult = {
  stats: WaitlistStats | null;
  isLoading: boolean;
  error: string | null;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useWaitlistStats(): UseWaitlistStatsResult {
  const { getToken } = useAuth();
  const [stats, setStats] = useState<WaitlistStats | null>(null);
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

        const url = `${API_URL}/api/v1/admin/waitlist/stats`;

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
          setStats(null);
          setIsLoading(false);
          return;
        }

        const body = await response.json();
        setStats(body.data ?? null);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
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

    return () => {
      controller.abort();
    };
  }, []);

  return { stats, isLoading, error };
}
