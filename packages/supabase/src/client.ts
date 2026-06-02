import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client (respects RLS with user's JWT).
 * Use this in API routes where you have the user's access token.
 */
export function createServerClient(accessToken?: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  });
}

/**
 * Service-role client (bypasses RLS). Use only in:
 * - Workers/background jobs
 * - Admin operations
 * - Server-side operations that don't act on behalf of a user
 *
 * NEVER expose the service role key to the client.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
