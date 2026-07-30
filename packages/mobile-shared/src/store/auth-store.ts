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

      if (response.error) {
        if (response.error.category === 'not_found' || response.error.code === 'PROFILE_REQUIRED') {
          // API confirmed: user has no profile row → redirect to register
          set({ profileExists: false, loading: false });
        } else {
          // Network/timeout/server error — can't determine state
          set({ profileExists: null, loading: false });
          if (response.error.category === 'server') {
            Sentry.captureMessage(`checkProfile failed: ${response.error.code}`, {
              level: 'warning',
              extra: { errorMessage: response.error.message },
            });
          }
        }
        return;
      }

      set({ profileExists: response.data !== null, loading: false });
    } catch (error) {
      set({ profileExists: null, loading: false });
      Sentry.captureException(error, { tags: { context: 'checkProfile' } });
    }
  },

  reset: () => {
    set({ profileExists: null, loading: true });
    Sentry.setUser(null);
  },
}));
