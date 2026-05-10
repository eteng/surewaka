import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client.
 * Uses the anon key (safe to expose) with RLS protecting data.
 * Used in React apps for auth flows and realtime subscriptions.
 */
export function createBrowserClient() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  return createClient(supabaseUrl, supabaseAnonKey);
}
