-- Add optional gender field to customer profiles.
-- Values are constrained to the three options shown in the mobile UI.
-- No backfill — existing rows remain null.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender text
  CHECK (gender IN ('woman', 'man', 'prefer_not_to_disclose'));
