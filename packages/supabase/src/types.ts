/**
 * Supabase user type — subset of what Supabase Auth returns.
 * Use this across the app instead of importing from @supabase/supabase-js directly.
 */
export type SupabaseUser = {
  id: string;
  email?: string;
  phone?: string;
  user_metadata: {
    name?: string;
    avatar_url?: string;
  };
  app_metadata: {
    role?: string;
  };
};
