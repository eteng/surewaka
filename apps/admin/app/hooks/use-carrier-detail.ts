import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export type CarrierRateHistoryEntry = {
  id: string;
  oldBasePriceKobo: number | null;
  newBasePriceKobo: number;
  changedBy: string | null;
  changedByName: string | null;
  reason: string | null;
  createdAt: string;
};

export type CarrierDetail = {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  logoUrl: string | null;
  isVerified: boolean;
  isActive: boolean;
  driverVettingEnabled: boolean;
  basePrice: number | null;
  rating: number | null;
  deliveryCount: number | null;
  createdAt: string;
  updatedAt: string;
  rateHistory: CarrierRateHistoryEntry[];
};

type UseCarrierDetailResult = {
  carrier: CarrierDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useCarrierDetail(carrierId: string): UseCarrierDetailResult {
  const { getToken } = useAuth();
  const [carrier, setCarrier] = useState<CarrierDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!carrierId) {
      setIsLoading(false);
      return;
    }

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

      const response = await fetch(`${API_URL}/api/v1/admin/carriers/${carrierId}`, {
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
        setCarrier(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setCarrier(body.data ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setCarrier(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [carrierId, getToken]);

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

  return { carrier, isLoading, error, refetch };
}

type UpdateRateParams = {
  carrierId: string;
  basePrice: number;
  reason?: string;
};

type UpdateRateResult = {
  success: boolean;
  error: string | null;
};

export function useUpdateCarrierRate() {
  const { getToken } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateRate = useCallback(
    async ({ carrierId, basePrice, reason }: UpdateRateParams): Promise<UpdateRateResult> => {
      setIsSubmitting(true);
      try {
        const accessToken = await getToken();
        if (!accessToken) {
          return { success: false, error: 'Not authenticated' };
        }

        const response = await fetch(`${API_URL}/api/v1/admin/carriers/${carrierId}/rate`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ basePrice, reason: reason || undefined }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message = body?.error?.message || `Request failed with status ${response.status}`;
          return { success: false, error: message };
        }

        return { success: true, error: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        return { success: false, error: message };
      } finally {
        setIsSubmitting(false);
      }
    },
    [getToken],
  );

  return { updateRate, isSubmitting };
}
