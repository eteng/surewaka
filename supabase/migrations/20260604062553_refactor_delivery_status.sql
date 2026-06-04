-- Migration: Refactor delivery_status enum (12 states) + add payment columns
-- Postgres cannot remove enum values, so we use a temp-column swap approach.

-- Step 1: Add temp column to preserve status as text
ALTER TABLE public.deliveries ADD COLUMN status_temp TEXT;
UPDATE public.deliveries SET status_temp = status::text;

-- Remap old values that don't exist in new enum
UPDATE public.deliveries SET status_temp = 'accepted'  WHERE status_temp = 'matched';
UPDATE public.deliveries SET status_temp = 'picked_up' WHERE status_temp = 'in_transit';

-- Step 2: Create new enum type
CREATE TYPE delivery_status_new AS ENUM (
  'draft',
  'pending',
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returned'
);

-- Step 3: Swap the type using the temp column
ALTER TABLE public.deliveries
  ALTER COLUMN status TYPE delivery_status_new
  USING status_temp::delivery_status_new;

-- Update default for status (new bookings start as draft)
ALTER TABLE public.deliveries
  ALTER COLUMN status SET DEFAULT 'draft';

-- Step 4: Clean up temp column and old type
ALTER TABLE public.deliveries DROP COLUMN status_temp;
DROP TYPE delivery_status;
ALTER TYPE delivery_status_new RENAME TO delivery_status;

-- Add payment columns to deliveries
ALTER TABLE public.deliveries
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'escrowed', 'released', 'refunded')),
  ADD COLUMN escrow_hold_id UUID REFERENCES public.escrow_holds(id),
  ADD COLUMN amount_paid BIGINT CHECK (amount_paid > 0);

CREATE INDEX idx_deliveries_payment_status ON public.deliveries(payment_status);
