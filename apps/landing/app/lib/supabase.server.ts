import { createServiceClient } from '@surewaka/supabase';

/**
 * Returns a Supabase admin client (service role) for server-side operations.
 * Used for waitlist signups where there is no authenticated user context.
 */
export function getSupabaseAdmin() {
  return createServiceClient();
}
