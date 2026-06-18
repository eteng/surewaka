import { create } from 'zustand';
import * as Sentry from '@sentry/react-native';
import { apiClient } from '../api/client';

/**
 * Auth store — tracks profile existence for post-signup routing.
 *
 * With Clerk, session/user state is managed by ClerkProvider + useAuth/useUser hooks.
 * This store only tracks whether the user has completed profile setup (has a row in
 * the `users` table) and provides a thin bridge for components that need this info
 * without being inside a Clerk hook context.
 */

type AuthState = {
  profileExists: boolean | null;
  loading: boolean;
  setProfileExists: (v: boolean | null) => void;
  setLoading: (loading: boolean) => void;
  checkProfile: (token: string) => Promise<void>;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  profileExists: null,
  loading: true,

  setProfileExists: (profileExists) => set({ profileExists }),
  setLoading: (loading) => set({ loading }),

  checkProfile: async (token: string) => {
    try {
      const response = await apiClient.get<{ id: string }>('/api/v1/profile', token);
      set({ profileExists: response.data !== null, loading: false });
    } catch {
      // Network error or 401 — assume profile doesn't exist yet
      set({ profileExists: false, loading: false });
    }
  },

  reset: () => {
    set({ profileExists: null, loading: true });
    Sentry.setUser(null);
  },
}));
