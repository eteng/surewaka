-- Hand-written idempotent data-fix migration.
--
-- Purpose: repair local/dev databases that are missing the
-- `platform_ledger_source_category_type_key` UNIQUE constraint (schema drift).
-- The constraint already exists on databases created from migration 0009, so on
-- Neon/CI both statements below are no-ops. On a drifted database it de-dupes any
-- rows that would block the constraint (keeping the earliest per key) and then
-- adds the constraint. Fully non-destructive beyond removing true duplicates.

-- 1. Remove duplicate (source_id, category, type) triples, keeping the earliest
--    row (by created_at, then id as a stable tiebreaker). No-op when there are
--    no duplicates.
DELETE FROM "platform_ledger" a
USING "platform_ledger" b
WHERE a."source_id" = b."source_id"
  AND a."category"  = b."category"
  AND a."type"      = b."type"
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );
--> statement-breakpoint

-- 2. Add the UNIQUE constraint only if it is not already present. Postgres does
--    not support ADD CONSTRAINT ... IF NOT EXISTS, so guard with a catalog check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_ledger_source_category_type_key'
      AND conrelid = '"platform_ledger"'::regclass
  ) THEN
    ALTER TABLE "platform_ledger"
      ADD CONSTRAINT "platform_ledger_source_category_type_key"
      UNIQUE ("source_id", "category", "type");
  END IF;
END $$;
