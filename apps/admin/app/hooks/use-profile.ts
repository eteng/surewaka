import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '~/lib/supabase';

export type ProfileResponse = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  avatarUrl: string | null;
  notificationEmail: boolean;
  notificationSms: boolean;
  verified: boolean;
  updatedAt: string;
  pendingNameChange: {
    id: string;
    requestedName: string;
    reason: string;
    status: 'pending';
    createdAt: string;
  } | null;
};

type PreferencesUpdate = {
  notificationEmail?: boolean;
  notificationSms?: boolean;
};

type NameChangeRequestData = {
  requestedName: string;
  reason: string;
};

type UseProfileResult = {
  profile: ProfileResponse | null;
  isLoading: boolean;
  error: string | null;
  updatePreferences: (data: PreferencesUpdate) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  submitNameChangeRequest: (data: NameChangeRequestData) => Promise<void>;
  isUpdating: boolean;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchProfile = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/profile`, {
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
        setProfile(null);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setProfile(body.data ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setProfile(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchProfile();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchProfile]);

  const updatePreferences = useCallback(async (data: PreferencesUpdate) => {
    setIsUpdating(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setError('Not authenticated');
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/profile`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || 'Failed to update preferences';
        setError(message);
        return;
      }

      const body = await response.json();
      setProfile(body.data ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    setIsUpdating(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setError('Not authenticated');
        return;
      }

      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch(`${API_URL}/api/v1/profile/avatar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || 'Failed to upload avatar';
        setError(message);
        return;
      }

      const body = await response.json();
      setProfile(body.data ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const removeAvatar = useCallback(async () => {
    setIsUpdating(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setError('Not authenticated');
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/profile/avatar`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || 'Failed to remove avatar';
        setError(message);
        return;
      }

      const body = await response.json();
      setProfile(body.data ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const submitNameChangeRequest = useCallback(async (data: NameChangeRequestData) => {
    setIsUpdating(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setError('Not authenticated');
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/profile/name-change-request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || 'Failed to submit name change request';
        setError(message);
        return;
      }

      // Refresh profile to get updated pendingNameChange
      await fetchProfile();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  }, [fetchProfile]);

  return {
    profile,
    isLoading,
    error,
    updatePreferences,
    uploadAvatar,
    removeAvatar,
    submitNameChangeRequest,
    isUpdating,
  };
}
