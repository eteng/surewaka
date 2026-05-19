import { useState, useEffect, useCallback } from 'react';

type User = {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'customer' | 'driver' | 'fleet_manager';
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (phone: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Initialize Supabase auth listener
    setLoading(false);
  }, []);

  const signIn = useCallback(async (phone: string) => {
    // TODO: Implement Supabase phone OTP sign-in
    console.log('Sign in with:', phone);
  }, []);

  const signOut = useCallback(async () => {
    // TODO: Implement sign-out
    setUser(null);
  }, []);

  return { user, loading, signIn, signOut };
}
