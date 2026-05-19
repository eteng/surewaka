-- Drop the existing unique index that uses COALESCE (incompatible with Drizzle Kit introspection)
DROP INDEX IF EXISTS idx_user_roles_unique_active;

-- Create a simple unique constraint matching the Drizzle schema definition
-- This uses (user_id, role, scope_id) directly without COALESCE
CREATE UNIQUE INDEX uq_user_roles_active ON user_roles (user_id, role, scope_id);;
