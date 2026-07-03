import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { OpsHubStats, AtRiskDelivery } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 30_000;

// ─── KPI stats ────────────────────────────────────────────────────────────────

export type UseOpsHubStatsResult = {
  stats: OpsHubStats | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useOpsHubStats(): UseOpsHubStatsResult {
  const { getToken } = useAuth();
  const [stats, setStats] = useState<OpsHubStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const refetch = useCallback(() => { void fetchStats(); }, [fetchStats]);

  useEffect(() => {
    void fetchStats();
    intervalRef.current = setInterval(() => { void fetchStats(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStats]);

  return { stats, isLoading, error, refetch };
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    void fetchAtRisk();
    intervalRef.current = setInterval(() => { void fetchAtRisk(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAtRisk]);

  return { atRisk, isLoading, error, refetch };
}
