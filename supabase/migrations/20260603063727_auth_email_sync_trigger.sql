-- Syncs a newly confirmed email from auth.users to public.users.email.
-- Fires after Supabase Auth commits a verified email change.
-- SECURITY DEFINER allows the function to write across the auth → public schema boundary.
-- search_path is pinned to prevent search path injection.

CREATE OR REPLACE FUNCTION public.sync_confirmed_email_to_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email_confirmed_at IS NOT NULL
     AND (
       OLD.email IS DISTINCT FROM NEW.email
       OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at
     )
  THEN
    UPDATE public.users
    SET email = NEW.email, updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_auth_email_to_users ON auth.users;
CREATE TRIGGER sync_auth_email_to_users
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_confirmed_email_to_users();
