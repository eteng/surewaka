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
    const resolveAal = async (user: User) => {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel().catch(() => ({ data: null }));
      setState(prev => ({ ...prev, aal: aalData }));
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      // Unblock loading immediately — AAL is fetched in the background
      setState({ user: session?.user ?? null, loading: false, aal: null });
      if (session?.user) resolveAal(session.user);
    }).catch(() => {
      setState({ user: null, loading: false, aal: null });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, loading: false, aal: null });
      if (session?.user) resolveAal(session.user);
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
