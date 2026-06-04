-- authenticated users need SELECT to read their own profile (checkProfileExists + profile UI)
-- and UPDATE for the users_update_own_profile RLS policy to apply.
-- INSERT goes through the API via service role; anon gets no access.
grant select, update on public.users to authenticated;
