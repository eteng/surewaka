-- Drop the partial unique index (incompatible with Drizzle Kit introspection)
DROP INDEX IF EXISTS idx_carrier_members_unique_active;

-- Create a simple unique constraint matching the Drizzle schema definition
CREATE UNIQUE INDEX uq_carrier_members_active ON carrier_members (carrier_id, user_id);;
