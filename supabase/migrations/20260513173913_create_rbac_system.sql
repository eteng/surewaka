-- RBAC System Migration
-- Creates: user_roles, carrier_members, role_audit_log tables
-- Updates: user_role enum to support new roles
-- Adds: RLS policies for role-based access control

-- =============================================================================
-- Step 1: Update the user_role enum to include all RBAC roles
-- =============================================================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'carrier_driver';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'carrier_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'support_agent';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'surewaka_admin';
-- =============================================================================
-- Step 2: Create carrier_member_role enum
-- =============================================================================
CREATE TYPE carrier_member_role AS ENUM ('carrier_admin', 'carrier_driver');
-- =============================================================================
-- Step 3: Extend carriers table for RBAC (add missing columns)
-- =============================================================================
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- =============================================================================
-- Step 4: Create user_roles table (canonical source of truth for roles)
-- =============================================================================
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  scope_type text, -- 'carrier' | null (global)
  scope_id uuid,  -- carrier_id when scope_type = 'carrier'
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);
-- Partial unique index: only one active role per (user, role, scope) combo
CREATE UNIQUE INDEX idx_user_roles_unique_active
  ON user_roles (user_id, role, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'))
  WHERE is_active = true;
-- Performance index for role lookups
CREATE INDEX idx_user_roles_user_active
  ON user_roles (user_id, is_active)
  WHERE is_active = true;
-- Index for querying users by role
CREATE INDEX idx_user_roles_role_active
  ON user_roles (role, is_active)
  WHERE is_active = true;
-- =============================================================================
-- Step 5: Create carrier_members table (org membership)
-- =============================================================================
CREATE TABLE carrier_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role carrier_member_role NOT NULL,
  invited_by uuid REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);
-- Partial unique index: one active membership per user per carrier
CREATE UNIQUE INDEX idx_carrier_members_unique_active
  ON carrier_members (carrier_id, user_id)
  WHERE is_active = true;
-- Performance index for scope checks
CREATE INDEX idx_carrier_members_user_carrier_active
  ON carrier_members (user_id, carrier_id, is_active)
  WHERE is_active = true;
-- =============================================================================
-- Step 6: Create role_audit_log table (append-only)
-- =============================================================================
CREATE TABLE role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  role user_role NOT NULL,
  action text NOT NULL CHECK (action IN ('assigned', 'revoked', 'upgraded')),
  scope_type text,
  scope_id uuid,
  performed_by uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Index for querying audit history by user
CREATE INDEX idx_role_audit_log_user
  ON role_audit_log (user_id, created_at DESC);
-- Index for querying audit history by performer
CREATE INDEX idx_role_audit_log_performer
  ON role_audit_log (performed_by, created_at DESC);
-- =============================================================================
-- Step 7: Helper function to check if user has a specific role (from JWT)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.has_role(required_role text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      COALESCE(auth.jwt()->'app_metadata'->'roles', '["customer"]'::jsonb)
    ) AS r
    WHERE r = required_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- Helper to get all user roles as text array
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS text[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT jsonb_array_elements_text(
      COALESCE(auth.jwt()->'app_metadata'->'roles', '["customer"]'::jsonb)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
-- =============================================================================
-- Step 8: Enable RLS on new tables
-- =============================================================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_audit_log ENABLE ROW LEVEL SECURITY;
-- =============================================================================
-- Step 9: RLS Policies for user_roles
-- =============================================================================

-- Users can read their own roles
CREATE POLICY "users_read_own_roles" ON user_roles
  FOR SELECT USING (user_id = auth.uid());
-- Admins can read all roles
CREATE POLICY "admins_read_all_roles" ON user_roles
  FOR SELECT USING (public.has_role('surewaka_admin'));
-- Only service role can insert/update/delete (via API, not direct client access)
CREATE POLICY "service_role_manage_roles" ON user_roles
  FOR ALL USING (auth.role() = 'service_role');
-- =============================================================================
-- Step 10: RLS Policies for carrier_members
-- =============================================================================

-- Users can see their own memberships
CREATE POLICY "users_read_own_memberships" ON carrier_members
  FOR SELECT USING (user_id = auth.uid());
-- Carrier admins can see members of their carrier
CREATE POLICY "carrier_admins_read_org_members" ON carrier_members
  FOR SELECT USING (
    carrier_id IN (
      SELECT cm.carrier_id FROM carrier_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'carrier_admin'
        AND cm.is_active = true
    )
  );
-- Admins can see all memberships
CREATE POLICY "admins_read_all_memberships" ON carrier_members
  FOR SELECT USING (public.has_role('surewaka_admin'));
-- Only service role can insert/update/delete
CREATE POLICY "service_role_manage_memberships" ON carrier_members
  FOR ALL USING (auth.role() = 'service_role');
-- =============================================================================
-- Step 11: RLS Policies for role_audit_log
-- =============================================================================

-- Only admins and support can read audit logs
CREATE POLICY "admins_read_audit_log" ON role_audit_log
  FOR SELECT USING (
    public.has_role('surewaka_admin') OR public.has_role('support_agent')
  );
-- Only service role can insert (append-only enforced at policy level)
CREATE POLICY "service_role_insert_audit" ON role_audit_log
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
-- No update or delete allowed (append-only)
CREATE POLICY "deny_update_audit_log" ON role_audit_log
  FOR UPDATE USING (false);
CREATE POLICY "deny_delete_audit_log" ON role_audit_log
  FOR DELETE USING (false);
-- =============================================================================
-- Step 12: RLS Policies for deliveries (role-aware)
-- =============================================================================

-- Enable RLS on deliveries if not already enabled
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
-- Customers see only their own deliveries
CREATE POLICY "customers_own_deliveries" ON deliveries
  FOR SELECT USING (
    customer_id = auth.uid()
    OR public.has_role('surewaka_admin')
    OR public.has_role('support_agent')
  );
-- Drivers see deliveries assigned to them
CREATE POLICY "drivers_assigned_deliveries" ON deliveries
  FOR SELECT USING (
    driver_id IN (
      SELECT d.id FROM drivers d WHERE d.user_id = auth.uid()
    )
    OR public.has_role('surewaka_admin')
  );
-- Carrier members see deliveries for their carrier
CREATE POLICY "carrier_org_deliveries" ON deliveries
  FOR SELECT USING (
    carrier_id IN (
      SELECT cm.carrier_id FROM carrier_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.is_active = true
    )
    OR public.has_role('surewaka_admin')
  );
-- =============================================================================
-- Step 13: RLS Policies for carriers table
-- =============================================================================

-- Enable RLS on carriers if not already enabled
ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
-- Anyone can read active carrier listings
CREATE POLICY "public_read_carriers" ON carriers
  FOR SELECT USING (is_active = true);
-- Carrier admins can update their own carrier
CREATE POLICY "carrier_admins_manage_own" ON carriers
  FOR UPDATE USING (
    id IN (
      SELECT cm.carrier_id FROM carrier_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'carrier_admin'
        AND cm.is_active = true
    )
    OR public.has_role('surewaka_admin')
  );
-- Service role can manage all carriers
CREATE POLICY "service_role_manage_carriers" ON carriers
  FOR ALL USING (auth.role() = 'service_role');
-- =============================================================================
-- Step 14: Seed existing users into user_roles table
-- =============================================================================
INSERT INTO user_roles (user_id, role, is_active, assigned_at)
SELECT id, role, true, created_at
FROM users
WHERE role IS NOT NULL
ON CONFLICT DO NOTHING;
-- =============================================================================
-- Step 15: Updated_at trigger for carriers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER carriers_updated_at
  BEFORE UPDATE ON carriers
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();
