-- Enforce global uniqueness on payment reference to prevent replay attacks:
-- a single Paystack reference can only ever credit one wallet, at the DB layer.
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_reference_key UNIQUE (reference);
