import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import type { AlertSettings } from '@surewaka/shared';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function useAlertSettings() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }
      const res = await fetch(`${API}/api/v1/admin/alert-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed with status ${res.status}`);
      setSettings(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alert settings');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const saveSettings = useCallback(
    async (updates: Partial<AlertSettings>): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(`${API}/api/v1/admin/alert-settings`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updates),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? `Request failed with status ${res.status}`);
        setSettings(json.data ?? null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save alert settings');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [getToken],
  );

  const sendTestAlert = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getToken();
      if (!token) return false;
      const res = await fetch(`${API}/api/v1/admin/alert-settings/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [getToken]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, isLoading, isSaving, error, saveSettings, sendTestAlert, refetch: fetchSettings };
}
