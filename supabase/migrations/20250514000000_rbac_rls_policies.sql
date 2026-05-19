-- =============================================================================
-- RLS Policies: carrier_admin_drivers + support_read_users
-- Adds missing RBAC RLS policies for carrier admin driver management
-- and support agent user profile access.
-- Requirements: 3.1, 3.4, 8.6
-- =============================================================================

-- =============================================================================
-- Step 1: Enable RLS on users table
-- =============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- =============================================================================
-- Step 2: carrier_admin_drivers policy on carrier_members
-- Carrier admins can manage (SELECT, INSERT, UPDATE, DELETE) only their org's
-- carrier_members records. surewaka_admin gets full access.
-- =============================================================================
DROP POLICY IF EXISTS "carrier_admin_drivers" ON carrier_members;
CREATE POLICY "carrier_admin_drivers" ON carrier_members
  FOR ALL USING (
    -- User is a carrier_admin for this specific carrier
    carrier_id IN (
      SELECT cm.carrier_id FROM carrier_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'carrier_admin'
        AND cm.is_active = true
    )
    -- surewaka_admin bypasses all checks
    OR public.has_role('surewaka_admin')
  )
  WITH CHECK (
    -- Same check for INSERT/UPDATE operations
    carrier_id IN (
      SELECT cm.carrier_id FROM carrier_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'carrier_admin'
        AND cm.is_active = true
    )
    OR public.has_role('surewaka_admin')
  );
-- =============================================================================
-- Step 3: support_read_users policy on users table
-- Support agents can read all user profiles. surewaka_admin gets full access.
-- All users can read their own profile.
-- =============================================================================
DROP POLICY IF EXISTS "support_read_users" ON users;
CREATE POLICY "support_read_users" ON users
  FOR SELECT USING (
    -- Users can always see their own profile
    id = auth.uid()
    -- Support agents can read all user profiles
    OR public.has_role('support_agent')
    -- surewaka_admin has full access
    OR public.has_role('surewaka_admin')
  );
-- =============================================================================
-- Step 4: Allow service role full access to users table
-- (API operations go through service role for mutations)
-- =============================================================================
DROP POLICY IF EXISTS "service_role_manage_users" ON users;
CREATE POLICY "service_role_manage_users" ON users
  FOR ALL USING (auth.role() = 'service_role');
-- =============================================================================
-- Step 5: Users can update their own profile
-- =============================================================================
DROP POLICY IF EXISTS "users_update_own_profile" ON users;
CREATE POLICY "users_update_own_profile" ON users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
