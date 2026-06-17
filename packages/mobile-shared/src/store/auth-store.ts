import { create } from 'zustand';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../supabase';
import type { User, Session } from '@supabase/supabase-js';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  profileExists: boolean | null;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setProfileExists: (v: boolean | null) => void;
  signIn: (phone: string) => Promise<{ error: string | null }>;
  verifyOtp: (phone: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
};

async function checkProfileExists(userId: string): Promise<boolean> {
  const { data } = await supabase.from('users').select('id').eq('id', userId).single();
  return !!data;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  initialized: false,
  profileExists: null,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setProfileExists: (profileExists) => set({ profileExists }),

  initialize: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      const profileExists = await checkProfileExists(session.user.id);
      set({ user: session.user, session, loading: false, initialized: true, profileExists });
      Sentry.setUser({ id: session.user.id, email: session.user.email });
    } else {
      set({ loading: false, initialized: true, profileExists: null });
    }

    supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (newSession?.user) {
        // Only re-check profile existence on SIGNED_IN (new login) or INITIAL_SESSION
        // when profileExists is still unknown. TOKEN_REFRESHED and subsequent
        // INITIAL_SESSION events must not overwrite a correctly-set profileExists —
        // a transient DB error during a redundant check would flip profileExists to
        // false and boot the user back to the register screen.
        const shouldCheckProfile =
          event === 'SIGNED_IN' ||
          (event === 'INITIAL_SESSION' && get().profileExists === null);

        if (shouldCheckProfile) {
          const profileExists = await checkProfileExists(newSession.user.id);
          set({ user: newSession.user, session: newSession, profileExists });
        } else {
          set({ user: newSession.user, session: newSession });
        }
        Sentry.setUser({ id: newSession.user.id, email: newSession.user.email });
      } else {
        set({ user: null, session: null, profileExists: null });
        Sentry.setUser(null);
      }
    });
  },

  signIn: async (phone: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { channel: 'sms' },
      });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Failed to send OTP. Please try again.' };
    }
  },

  verifyOtp: async (phone: string, token: string) => {
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Failed to verify OTP. Please try again.' };
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null });
    Sentry.setUser(null);
  },
}));
