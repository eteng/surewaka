import { useState, useEffect, useCallback } from 'react';
import { supabase, useAuthStore } from '@surewaka/mobile-shared';
import { toast } from 'sonner-native';
import type { Gender } from '@surewaka/shared';
import { processAvatarImage } from '../utils/image-processing';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: Gender | null;
  notificationEmail: boolean;
  notificationSms: boolean;
  pendingEmail: string | null;
  avatarUrl: string | null;
};

type MutationResult = { error: string | null };

type UseCustomerProfile = {
  profile: CustomerProfile | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateName: (name: string) => Promise<MutationResult>;
  updateEmail: (email: string) => Promise<MutationResult>;
  updateGender: (gender: Gender | null) => Promise<MutationResult>;
  updateNotifications: (prefs: {
    notificationEmail?: boolean;
    notificationSms?: boolean;
  }) => Promise<MutationResult>;
  updateAvatar: (localUri: string) => Promise<MutationResult>;
  removeAvatar: () => Promise<MutationResult>;
  isUploadingAvatar: boolean;
};

export function useCustomerProfile(): UseCustomerProfile {
  const userId = useAuthStore((s) => s.user?.id);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);

    const [{ data: row, error: dbError }, { data: authData }] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).single(),
      supabase.auth.getUser(),
    ]);

    if (dbError || !row) {
      setError('Failed to load profile. Please try again.');
      setIsLoading(false);
      return;
    }

    setProfile({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email ?? null,
      gender: (row.gender as Gender) ?? null,
      notificationEmail: row.notification_email ?? true,
      notificationSms: row.notification_sms ?? true,
      pendingEmail: authData.user?.new_email ?? null,
      avatarUrl: row.avatar_url ?? null,
    });
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateName = useCallback(
    async (name: string): Promise<MutationResult> => {
      if (!userId) return { error: 'Not authenticated' };

      const { error: dbError } = await supabase
        .from('users')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (dbError) return { error: 'Failed to update name. Please try again.' };

      // Keep auth metadata consistent — best-effort, non-blocking
      supabase.auth.updateUser({ data: { name } }).catch(() => {});

      setProfile((prev) => (prev ? { ...prev, name } : prev));
      return { error: null };
    },
    [userId],
  );

  const updateEmail = useCallback(
    async (email: string): Promise<MutationResult> => {
      const { error: authError } = await supabase.auth.updateUser({ email });
      if (authError) return { error: 'Failed to send verification email. Please try again.' };

      // Reflect the pending state immediately from the updated session
      const { data: authData } = await supabase.auth.getUser();
      setProfile((prev) =>
        prev ? { ...prev, pendingEmail: authData.user?.new_email ?? email } : prev,
      );
      return { error: null };
    },
    [],
  );

  const updateGender = useCallback(
    async (gender: Gender | null): Promise<MutationResult> => {
      if (!userId) return { error: 'Not authenticated' };

      const { error: dbError } = await supabase
        .from('users')
        .update({ gender, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (dbError) return { error: 'Failed to update gender. Please try again.' };

      setProfile((prev) => (prev ? { ...prev, gender } : prev));
      return { error: null };
    },
    [userId],
  );

  const updateNotifications = useCallback(
    async (prefs: {
      notificationEmail?: boolean;
      notificationSms?: boolean;
    }): Promise<MutationResult> => {
      if (!userId) return { error: 'Not authenticated' };

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (prefs.notificationEmail !== undefined) patch.notification_email = prefs.notificationEmail;
      if (prefs.notificationSms !== undefined) patch.notification_sms = prefs.notificationSms;

      const { error: dbError } = await supabase.from('users').update(patch).eq('id', userId);

      if (dbError) return { error: 'Failed to update notifications. Please try again.' };

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              ...(prefs.notificationEmail !== undefined && {
                notificationEmail: prefs.notificationEmail,
              }),
              ...(prefs.notificationSms !== undefined && {
                notificationSms: prefs.notificationSms,
              }),
            }
          : prev,
      );
      return { error: null };
    },
    [userId],
  );

  const updateAvatar = useCallback(
    async (localUri: string): Promise<MutationResult> => {
      if (!userId) return { error: 'Not authenticated' };

      setIsUploadingAvatar(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return { error: 'Not authenticated' };

        const { blob: arrayBuffer, mimeType } = await processAvatarImage(localUri);

        const formData = new FormData();
        formData.append('avatar', new Blob([arrayBuffer], { type: mimeType }), 'avatar.jpg');

        const res = await fetch(`${API_URL}/api/v1/profile/avatar`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!res.ok) {
          toast.error('Upload failed. Check your connection and try again.');
          return { error: 'Upload failed. Check your connection and try again.' };
        }

        const json = await res.json();
        const avatarUrl: string = json.data.avatarUrl;

        setProfile((prev) => (prev ? { ...prev, avatarUrl } : prev));
        return { error: null };
      } catch {
        toast.error('Failed to process image. Please try again.');
        return { error: 'Failed to process image. Please try again.' };
      } finally {
        setIsUploadingAvatar(false);
      }
    },
    [userId],
  );

  const removeAvatar = useCallback(async (): Promise<MutationResult> => {
    if (!userId) return { error: 'Not authenticated' };

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return { error: 'Not authenticated' };

      const res = await fetch(`${API_URL}/api/v1/profile/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        toast.error('Failed to remove photo. Please try again.');
        return { error: 'Failed to remove photo. Please try again.' };
      }

      setProfile((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
      return { error: null };
    } catch {
      toast.error('Failed to remove photo. Please try again.');
      return { error: 'Failed to remove photo. Please try again.' };
    }
  }, [userId]);

  return {
    profile,
    isLoading,
    error,
    refetch: fetchProfile,
    updateName,
    updateEmail,
    updateGender,
    updateNotifications,
    updateAvatar,
    removeAvatar,
    isUploadingAvatar,
  };
}
