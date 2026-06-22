import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CarrierApplicationDetail, ApproveCarrierApplicationInput, RejectCarrierApplicationInput } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type DetailResult = {
  application: CarrierApplicationDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  startReview: (notes?: string) => Promise<{ ok: boolean; error?: string }>;
  approve: (input: ApproveCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
  reject: (input: RejectCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
};

export function useCarrierApplicationDetail(applicationId: string): DetailResult {
  const { getToken } = useAuth();
  const [application, setApplication] = useState<CarrierApplicationDetail | null>(null);
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
      const res = await fetch(`${API_URL}/api/v1/admin/carriers/applications/${applicationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) return;
      if (!res.ok) { setError('Failed to load application'); setIsLoading(false); return; }

      const json = await res.json();
      setApplication(json.data);
      setIsLoading(false);
    })().catch((err) => {
      if (!cancelled) { setError(String(err)); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [applicationId, tick]);

  const post = useCallback(async (path: string, body: unknown) => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/v1/admin/carriers/applications/${applicationId}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { ok: res.ok, error: res.ok ? undefined : (json.error?.message ?? 'Request failed') };
  }, [applicationId, getToken]);

  const startReview = useCallback((notes?: string) => post('review', { notes }), [post]);
  const approve = useCallback((input: ApproveCarrierApplicationInput) => post('approve', input), [post]);
  const reject = useCallback((input: RejectCarrierApplicationInput) => post('reject', input), [post]);

  return { application, isLoading, error, refetch, startReview, approve, reject };
}
