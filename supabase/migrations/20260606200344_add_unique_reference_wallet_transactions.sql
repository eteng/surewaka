-- Enforce global uniqueness on payment reference to prevent replay attacks:
-- a single Paystack reference can only ever credit one wallet, at the DB layer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_reference_key'
  ) THEN
    ALTER TABLE public.wallet_transactions
      ADD CONSTRAINT wallet_transactions_reference_key UNIQUE (reference);
  END IF;
END $$;
