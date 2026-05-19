-- Remove legacy 'carrier' and 'admin' values from user_role enum
-- Postgres doesn't support DROP VALUE from enum, so we recreate it

-- Step 1: Create new enum type
CREATE TYPE user_role_new AS ENUM (
  'customer',
  'driver',
  'carrier_driver',
  'carrier_admin',
  'support_agent',
  'surewaka_admin'
);

-- Step 2: Alter columns to use new enum
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE user_role_new USING role::text::user_role_new;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'customer'::user_role_new;

ALTER TABLE user_roles
  ALTER COLUMN role TYPE user_role_new USING role::text::user_role_new;

ALTER TABLE role_audit_log
  ALTER COLUMN role TYPE user_role_new USING role::text::user_role_new;

-- Step 3: Drop old enum and rename new one
DROP TYPE user_role;
ALTER TYPE user_role_new RENAME TO user_role;

-- Step 4: Make carriers.slug NOT NULL
ALTER TABLE carriers
  ALTER COLUMN slug SET NOT NULL;

-- Step 5: Drop legacy carriers.verified column (replaced by is_verified)
ALTER TABLE carriers
  DROP COLUMN verified;;
