import { create } from 'zustand';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../supabase';
import type { User, Session } from '@supabase/supabase-js';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  signIn: (phone: string) => Promise<{ error: string | null }>;
  verifyOtp: (phone: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  initialized: false,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),

  initialize: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      set({ user: session.user, session, loading: false, initialized: true });
      Sentry.setUser({ id: session.user.id, email: session.user.email });
    } else {
      set({ loading: false, initialized: true });
    }

    supabase.auth.onAuthStateChange((_event, newSession) => {
      set({ user: newSession?.user ?? null, session: newSession });
      if (newSession?.user) {
        Sentry.setUser({ id: newSession.user.id, email: newSession.user.email });
      } else {
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
