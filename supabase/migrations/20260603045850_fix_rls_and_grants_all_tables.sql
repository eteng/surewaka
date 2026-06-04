-- =============================================================================
-- Comprehensive RLS + grants audit
-- Ensures every public table has:
--   1. RLS enabled
--   2. A service_role bypass policy (API mutations always go through service role)
--   3. Grants scoped to what authenticated users actually need
-- Tables already correct (users, user_saved_addresses, recent_locations) are
-- left untouched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- notifications
-- RLS was already ON and policies already existed; only grants were missing.
-- SELECT + UPDATE for authenticated (mark-read). INSERT/DELETE are for workers
-- via service role — granting those to authenticated would let any user write
-- or delete any user's notifications.
-- ---------------------------------------------------------------------------
grant select, update on public.notifications to authenticated;


-- ---------------------------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------------------------
alter table public.deliveries enable row level security;

-- Service role: full access (all API mutations go through here)
drop policy if exists "service_role_manage_deliveries" on public.deliveries;
create policy "service_role_manage_deliveries" on public.deliveries
  for all using (auth.role() = 'service_role');

-- Customers see their own deliveries
drop policy if exists "customers_read_own_deliveries" on public.deliveries;
create policy "customers_read_own_deliveries" on public.deliveries
  for select using (
    customer_id = auth.uid()
    or has_role('support_agent')
    or has_role('surewaka_admin')
  );

-- Drivers see deliveries assigned to them
drop policy if exists "drivers_read_assigned_deliveries" on public.deliveries;
create policy "drivers_read_assigned_deliveries" on public.deliveries
  for select using (
    driver_id in (select id from public.drivers where user_id = auth.uid())
  );

-- Authenticated users read only; all writes go through the API
grant select on public.deliveries to authenticated;


-- ---------------------------------------------------------------------------
-- carriers
-- Catalog table: authenticated users need SELECT to browse carriers at booking.
-- All writes are admin-only via the API.
-- ---------------------------------------------------------------------------
alter table public.carriers enable row level security;

drop policy if exists "service_role_manage_carriers" on public.carriers;
create policy "service_role_manage_carriers" on public.carriers
  for all using (auth.role() = 'service_role');

-- Active carriers are visible to all authenticated users; admins see all
drop policy if exists "authenticated_read_active_carriers" on public.carriers;
create policy "authenticated_read_active_carriers" on public.carriers
  for select using (
    is_active = true
    or has_role('surewaka_admin')
  );

grant select on public.carriers to authenticated;


-- ---------------------------------------------------------------------------
-- carrier_members
-- The carrier_admin_drivers policy already existed but RLS was never enabled,
-- making it a no-op. Enable RLS and add the service_role + self-read policies.
-- ---------------------------------------------------------------------------
alter table public.carrier_members enable row level security;

drop policy if exists "service_role_manage_carrier_members" on public.carrier_members;
create policy "service_role_manage_carrier_members" on public.carrier_members
  for all using (auth.role() = 'service_role');

-- Members can read their own membership record (e.g. to know their carrier role)
drop policy if exists "members_read_own_membership" on public.carrier_members;
create policy "members_read_own_membership" on public.carrier_members
  for select using (user_id = auth.uid());

-- carrier_admin_drivers (already exists) handles carrier admin management

grant select on public.carrier_members to authenticated;


-- ---------------------------------------------------------------------------
-- drivers
-- ---------------------------------------------------------------------------
alter table public.drivers enable row level security;

drop policy if exists "service_role_manage_drivers" on public.drivers;
create policy "service_role_manage_drivers" on public.drivers
  for all using (auth.role() = 'service_role');

-- Customers/dispatchers can see available verified drivers
drop policy if exists "authenticated_read_available_drivers" on public.drivers;
create policy "authenticated_read_available_drivers" on public.drivers
  for select using (
    (available = true and verified = true)
    or has_role('surewaka_admin')
    or has_role('support_agent')
  );

-- Drivers can read and update their own profile
drop policy if exists "drivers_manage_own_profile" on public.drivers;
create policy "drivers_manage_own_profile" on public.drivers
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.drivers to authenticated;


-- ---------------------------------------------------------------------------
-- name_change_requests
-- ---------------------------------------------------------------------------
alter table public.name_change_requests enable row level security;

drop policy if exists "service_role_manage_name_change_requests" on public.name_change_requests;
create policy "service_role_manage_name_change_requests" on public.name_change_requests
  for all using (auth.role() = 'service_role');

-- Users can read their own requests; admins/support see all
drop policy if exists "users_read_own_name_change_requests" on public.name_change_requests;
create policy "users_read_own_name_change_requests" on public.name_change_requests
  for select using (
    user_id = auth.uid()
    or has_role('surewaka_admin')
    or has_role('support_agent')
  );

-- Users can only submit requests for themselves
drop policy if exists "users_insert_own_name_change_requests" on public.name_change_requests;
create policy "users_insert_own_name_change_requests" on public.name_change_requests
  for insert with check (user_id = auth.uid());

grant select, insert on public.name_change_requests to authenticated;


-- ---------------------------------------------------------------------------
-- user_roles
-- Managed exclusively by the API (service role). authenticated gets SELECT so
-- admin UIs can display role assignments without going through the API.
-- has_role() reads JWT claims — not this table — so no SELECT is needed for
-- the permission check itself.
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;

drop policy if exists "service_role_manage_user_roles" on public.user_roles;
create policy "service_role_manage_user_roles" on public.user_roles
  for all using (auth.role() = 'service_role');

-- Users can see their own role assignments; admins see all
drop policy if exists "users_read_own_roles" on public.user_roles;
create policy "users_read_own_roles" on public.user_roles
  for select using (
    user_id = auth.uid()
    or has_role('surewaka_admin')
  );

grant select on public.user_roles to authenticated;


-- ---------------------------------------------------------------------------
-- role_audit_log
-- Internal audit trail — no direct client access. API writes; admin reads.
-- ---------------------------------------------------------------------------
alter table public.role_audit_log enable row level security;

drop policy if exists "service_role_manage_role_audit_log" on public.role_audit_log;
create policy "service_role_manage_role_audit_log" on public.role_audit_log
  for all using (auth.role() = 'service_role');

drop policy if exists "admin_read_role_audit_log" on public.role_audit_log;
create policy "admin_read_role_audit_log" on public.role_audit_log
  for select using (has_role('surewaka_admin'));

grant select on public.role_audit_log to authenticated;


-- ---------------------------------------------------------------------------
-- waitlist_signups
-- Server-side SSR action writes via service role (getSupabaseAdmin).
-- No direct client access needed — enabling RLS with only service_role and
-- admin policies locks out the overly-broad grants that were previously in place.
-- ---------------------------------------------------------------------------
alter table public.waitlist_signups enable row level security;

drop policy if exists "service_role_manage_waitlist" on public.waitlist_signups;
create policy "service_role_manage_waitlist" on public.waitlist_signups
  for all using (auth.role() = 'service_role');

drop policy if exists "admin_read_waitlist" on public.waitlist_signups;
create policy "admin_read_waitlist" on public.waitlist_signups
  for select using (has_role('surewaka_admin'));
