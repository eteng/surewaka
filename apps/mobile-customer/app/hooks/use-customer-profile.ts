import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import { apiClient } from '@surewaka/mobile-shared';
import { toast } from 'sonner-native';
import type { Gender } from '@surewaka/shared';


const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: Gender | null;
  notificationEmail: boolean;
  notificationSms: boolean;
  notificationPush: boolean;
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
    notificationPush?: boolean;
  }) => Promise<MutationResult>;
  updateAvatar: (localUri: string) => Promise<MutationResult>;
  removeAvatar: () => Promise<MutationResult>;
  isUploadingAvatar: boolean;
};

export function useCustomerProfile(): UseCustomerProfile {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const fetchProfile = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setIsLoading(true);
    setError(null);

    const response = await apiClient.get<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      avatarUrl: string | null;
      notificationEmail: boolean;
      notificationSms: boolean;
      notificationPush: boolean;
      verified: boolean;
    }>('/api/v1/profile', token);

    if (response.error || !response.data) {
      setError('Failed to load profile. Please try again.');
      setIsLoading(false);
      return;
    }

    const data = response.data;
    setProfile({
      id: data.id,
      name: data.name,
      phone: data.phone,
      email: data.email,
      gender: null, // TODO: expose gender in profile API response
      notificationEmail: data.notificationEmail,
      notificationSms: data.notificationSms,
      notificationPush: data.notificationPush,
      pendingEmail: null,
      avatarUrl: data.avatarUrl,
    });
    setIsLoading(false);
  }, [getToken]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateName = useCallback(
    async (name: string): Promise<MutationResult> => {
      const token = await getToken();
      if (!token) return { error: 'Not authenticated' };

      const response = await apiClient.patch('/api/v1/profile/preferences', { name }, token);
      if (response.error) return { error: 'Failed to update name. Please try again.' };

      setProfile((prev) => (prev ? { ...prev, name } : prev));
      return { error: null };
    },
    [getToken],
  );

  const updateEmail = useCallback(
    async (email: string): Promise<MutationResult> => {
      // Update email through Clerk directly
      try {
        await user?.createEmailAddress({ email });
        setProfile((prev) => (prev ? { ...prev, pendingEmail: email } : prev));
        return { error: null };
      } catch {
        return { error: 'Failed to update email. Please try again.' };
      }
    },
    [user],
  );

  const updateGender = useCallback(
    async (gender: Gender | null): Promise<MutationResult> => {
      const token = await getToken();
      if (!token) return { error: 'Not authenticated' };

      const response = await apiClient.patch('/api/v1/profile/preferences', { gender }, token);
      if (response.error) return { error: 'Failed to update gender. Please try again.' };

      setProfile((prev) => (prev ? { ...prev, gender } : prev));
      return { error: null };
    },
    [getToken],
  );

  const updateNotifications = useCallback(
    async (prefs: {
      notificationEmail?: boolean;
      notificationSms?: boolean;
      notificationPush?: boolean;
    }): Promise<MutationResult> => {
      const token = await getToken();
      if (!token) return { error: 'Not authenticated' };

      const response = await apiClient.patch('/api/v1/profile/preferences', prefs, token);
      if (response.error) return { error: 'Failed to update notifications. Please try again.' };

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
              ...(prefs.notificationPush !== undefined && {
                notificationPush: prefs.notificationPush,
              }),
            }
          : prev,
      );
      return { error: null };
    },
    [getToken],
  );

  const updateAvatar = useCallback(
    async (localUri: string): Promise<MutationResult> => {
      const token = await getToken();
      if (!token) return { error: 'Not authenticated' };

      setIsUploadingAvatar(true);

      try {
        const mimeType = "image/jpeg";

        const formData = new FormData();
        formData.append('avatar', {
          uri: localUri,
          type: mimeType,
          name: 'avatar.jpg',
        } as unknown as Blob);

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
    [getToken],
  );

  const removeAvatar = useCallback(async (): Promise<MutationResult> => {
    const token = await getToken();
    if (!token) return { error: 'Not authenticated' };

    try {
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
  }, [getToken]);

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
