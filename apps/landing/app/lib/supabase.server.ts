import { db, waitlistSignups } from '@surewaka/db';
import { eq } from 'drizzle-orm';

/**
 * Minimal Drizzle-based client that mimics the subset of Supabase PostgREST API
 * used by landing page routes (waitlist signups only).
 *
 * This is a temporary compatibility shim. Routes should be migrated to use
 * Drizzle directly for clarity.
 */
export function getSupabaseAdmin() {
  return {
    from(table: string) {
      if (table !== 'waitlist_signups') {
        throw new Error(`[Landing DB Shim] Unsupported table: ${table}`);
      }

      return {
        async insert(values: {
          full_name: string;
          email: string;
          user_type: string;
          source?: string;
        }) {
          try {
            await db.insert(waitlistSignups).values({
              fullName: values.full_name,
              email: values.email,
              userType: values.user_type as 'sender' | 'business' | 'driver',
              source: values.source ?? 'home',
            });
            return { error: null };
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            // Handle unique constraint violation (duplicate email)
            if (message.includes('unique') || message.includes('duplicate')) {
              return { error: { message: 'This email is already on the waitlist', code: '23505' } };
            }
            return { error: { message, code: 'UNKNOWN' } };
          }
        },

        select(columns?: string) {
          return {
            async eq(column: string, value: string) {
              if (column === 'email') {
                const results = await db
                  .select()
                  .from(waitlistSignups)
                  .where(eq(waitlistSignups.email, value))
                  .limit(1);
                return { data: results, error: null };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
}
