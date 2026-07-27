import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export type ConfigItem = {
  key: string;
  value: unknown;
  label: string;
  description: string | null;
  category: string;
  default: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
};

export function useSystemConfig() {
  const { getToken } = useAuth();
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${API}/api/v1/admin/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      setItems(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const saveConfig = useCallback(async (key: string, value: unknown): Promise<boolean> => {
    setSaving(key);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API}/api/v1/admin/config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      setItems((prev) =>
        prev.map((item) => item.key === key ? { ...item, value, updatedAt: json.data.updatedAt } : item),
      );
      setSaveSuccess(key);
      setTimeout(() => setSaveSuccess(null), 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      return false;
    } finally {
      setSaving(null);
    }
  }, [getToken]);

  const resetConfig = useCallback(async (key: string): Promise<boolean> => {
    setSaving(key);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API}/api/v1/admin/config/${encodeURIComponent(key)}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      setItems((prev) =>
        prev.map((item) =>
          item.key === key ? { ...item, value: json.data.value, updatedAt: null, updatedBy: null } : item,
        ),
      );
      setSaveSuccess(key);
      setTimeout(() => setSaveSuccess(null), 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset');
      return false;
    } finally {
      setSaving(null);
    }
  }, [getToken]);

  const exportConfig = useCallback(async (): Promise<void> => {
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`${API}/api/v1/admin/config/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'surewaka-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [getToken]);

  const importConfig = useCallback(async (
    file: File,
  ): Promise<{ imported: number; skipped: number } | null> => {
    const token = await getToken();
    if (!token) return null;
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const res = await fetch(`${API}/api/v1/admin/config/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(parsed),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? `Import failed (${res.status})`);
    await fetchAll();
    return json.data as { imported: number; skipped: number };
  }, [getToken, fetchAll]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    items,
    isLoading,
    error,
    saving,
    saveSuccess,
    saveConfig,
    resetConfig,
    exportConfig,
    importConfig,
    refetch: fetchAll,
  };
}
