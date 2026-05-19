import { useEffect, useState } from 'react';
import type { User, AuthenticatorAssuranceLevels } from '@supabase/supabase-js';
import { supabase } from '~/lib/supabase';

type AuthState = {
  user: User | null;
  loading: boolean;
  aal: AuthenticatorAssuranceLevels | null;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    aal: null,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        setState({ user: session.user, loading: false, aal: aalData });
      } else {
        setState({ user: null, loading: false, aal: null });
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        setState({ user: session.user, loading: false, aal: aalData });
      } else {
        setState({ user: null, loading: false, aal: null });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getMfaFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  return { data, error };
}

export async function enrollMfa() {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  });
  return { data, error };
}

export async function challengeMfa(factorId: string) {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  return { data, error };
}

export async function verifyMfa(factorId: string, challengeId: string, code: string) {
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  });
  return { data, error };
}
