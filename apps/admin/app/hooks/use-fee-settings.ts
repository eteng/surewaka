import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import type { FeeSettings, VehicleType } from '@surewaka/shared';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

type FeeSettingsRow = FeeSettings & { id: string; updatedAt: string };

type VehicleTypeRateRow = {
  id: string;
  vehicleType: VehicleType;
  multiplier: string;
  updatedAt: string;
};

export function useFeeSettings() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<FeeSettingsRow | null>(null);
  const [vehicleTypeRates, setVehicleTypeRates] = useState<VehicleTypeRateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRate, setIsSavingRate] = useState<VehicleType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [rateSuccess, setRateSuccess] = useState<VehicleType | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }

      const [settingsRes, ratesRes] = await Promise.all([
        fetch(`${API}/api/v1/admin/fee-settings`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/v1/admin/fee-settings/vehicle-type-rates`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const settingsJson = await settingsRes.json();
      const ratesJson = await ratesRes.json();

      if (!settingsRes.ok) {
        throw new Error(settingsJson.error?.message ?? `Fee settings request failed (${settingsRes.status})`);
      }
      if (!ratesRes.ok) {
        throw new Error(ratesJson.error?.message ?? `Vehicle rates request failed (${ratesRes.status})`);
      }

      setSettings(settingsJson.data ?? null);
      setVehicleTypeRates(ratesJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fee settings');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const saveSettings = useCallback(
    async (updates: Partial<FeeSettings>): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');

        const res = await fetch(`${API}/api/v1/admin/fee-settings`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updates),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message ?? `Request failed (${res.status})`);
        }

        setSettings(json.data ?? null);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save fee settings');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [getToken],
  );

  const saveVehicleTypeRate = useCallback(
    async (vehicleType: VehicleType, multiplier: number): Promise<boolean> => {
      setIsSavingRate(vehicleType);
      setError(null);
      setRateSuccess(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');

        const res = await fetch(`${API}/api/v1/admin/fee-settings/vehicle-type-rates`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ vehicleType, multiplier }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message ?? `Request failed (${res.status})`);
        }

        setVehicleTypeRates((prev) =>
          prev.map((r) => (r.vehicleType === vehicleType ? json.data : r)),
        );
        setRateSuccess(vehicleType);
        setTimeout(() => setRateSuccess(null), 3000);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save vehicle type rate');
        return false;
      } finally {
        setIsSavingRate(null);
      }
    },
    [getToken],
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    settings,
    vehicleTypeRates,
    isLoading,
    isSaving,
    isSavingRate,
    error,
    saveSuccess,
    rateSuccess,
    saveSettings,
    saveVehicleTypeRate,
    refetch: fetchAll,
  };
}
