import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { OpsHubStats, AtRiskDelivery } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 30_000;

// ─── Visibility-aware polling helper ──────────────────────────────────────────

function useVisibilityPolling(fetchFn: () => void, intervalMs: number) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function startPolling() {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchFn, intervalMs);
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchFn();
        startPolling();
      }
    }

    // Initial fetch + start
    fetchFn();
    startPolling();

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchFn, intervalMs]);
}

// ─── KPI stats ────────────────────────────────────────────────────────────────

export type UseOpsHubStatsResult = {
  stats: OpsHubStats | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refetch: () => void;
};

export function useOpsHubStats(): UseOpsHubStatsResult {
  const { getToken } = useAuth();
  const [stats, setStats] = useState<OpsHubStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/ops-hub/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: OpsHubStats; error: null };
      setStats(body.data);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const refetch = useCallback(() => { void fetchStats(); }, [fetchStats]);

  useVisibilityPolling(refetch, POLL_INTERVAL_MS);

  return { stats, isLoading, error, lastUpdated, refetch };
}

// ─── At-risk deliveries ───────────────────────────────────────────────────────

export type UseAtRiskDeliveriesResult = {
  atRisk: AtRiskDelivery[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useAtRiskDeliveries(): UseAtRiskDeliveriesResult {
  const { getToken } = useAuth();
  const [atRisk, setAtRisk] = useState<AtRiskDelivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAtRisk = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/ops-hub/at-risk`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: AtRiskDelivery[]; error: null };
      setAtRisk(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load at-risk deliveries');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const refetch = useCallback(() => { void fetchAtRisk(); }, [fetchAtRisk]);

  useVisibilityPolling(refetch, POLL_INTERVAL_MS);

  return { atRisk, isLoading, error, refetch };
}
