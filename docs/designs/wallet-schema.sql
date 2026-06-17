-- Wallet Payment System Schema Design
-- To be applied via: supabase migration new add_wallet_payment_system
-- Then copy this SQL into the migration file

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE wallet_status AS ENUM ('active', 'frozen', 'closed');

CREATE TYPE transaction_type AS ENUM (
  'fund',           -- money in from Paystack
  'debit',          -- generic debit (rare, prefer specific types)
  'escrow_hold',    -- deducted from sender at booking
  'escrow_release', -- credited to driver on delivery confirmation
  'refund',         -- returned to sender (cancellation/dispute)
  'payout',         -- withdrawn to bank account
  'commission',     -- SureWaka platform fee
  'adjustment'      -- manual correction by admin
);

CREATE TYPE escrow_status AS ENUM ('held', 'released', 'refunded', 'disputed', 'partially_refunded');

-- ============================================
-- WALLETS
-- ============================================

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), -- kobo (₦1 = 100 kobo)
  currency TEXT NOT NULL DEFAULT 'NGN',
  status wallet_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, currency)
);

-- Index for quick balance lookups
CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- ============================================
-- WALLET TRANSACTIONS (append-only ledger)
-- ============================================

CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  type transaction_type NOT NULL,
  amount BIGINT NOT NULL, -- positive = credit, negative = debit
  balance_after BIGINT NOT NULL, -- snapshot of wallet balance after this txn
  reference TEXT UNIQUE, -- Paystack reference, delivery ID, etc.
  description TEXT, -- human-readable (e.g., "Delivery to Lekki Phase 1")
  metadata JSONB NOT NULL DEFAULT '{}', -- provider response, delivery details, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Never allow updates or deletes on transactions (immutable ledger)
-- Enforced at application layer + RLS

CREATE INDEX idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_transactions_reference ON wallet_transactions(reference);
CREATE INDEX idx_wallet_transactions_type ON wallet_transactions(type);
CREATE INDEX idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

-- ============================================
-- ESCROW HOLDS
-- ============================================

CREATE TABLE escrow_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL, -- references deliveries(id) when that table exists
  sender_wallet_id UUID NOT NULL REFERENCES wallets(id),
  driver_wallet_id UUID REFERENCES wallets(id), -- set when driver assigned
  total_amount BIGINT NOT NULL, -- full amount held from sender (kobo)
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.1500, -- 15% default
  commission_amount BIGINT NOT NULL DEFAULT 0, -- calculated on release
  driver_amount BIGINT NOT NULL DEFAULT 0, -- calculated on release
  status escrow_status NOT NULL DEFAULT 'held',
  held_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_escrow_holds_delivery_id ON escrow_holds(delivery_id);
CREATE INDEX idx_escrow_holds_status ON escrow_holds(status);
CREATE INDEX idx_escrow_holds_sender_wallet ON escrow_holds(sender_wallet_id);

-- ============================================
-- PAYOUT REQUESTS (driver → bank account)
-- ============================================

CREATE TABLE payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount BIGINT NOT NULL CHECK (amount > 0), -- kobo
  bank_code TEXT NOT NULL, -- Nigerian bank code (e.g., '058' for GTBank)
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  paystack_transfer_code TEXT, -- Paystack transfer reference
  paystack_recipient_code TEXT, -- Paystack transfer recipient
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  failure_reason TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payout_requests_wallet_id ON payout_requests(wallet_id);
CREATE INDEX idx_payout_requests_status ON payout_requests(status);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

-- Users can read their own wallet
CREATE POLICY "Users can view own wallet"
  ON wallets FOR SELECT
  USING (user_id = auth.uid());

-- Users can read their own transactions
CREATE POLICY "Users can view own transactions"
  ON wallet_transactions FOR SELECT
  USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));

-- Users can view escrow for their deliveries (as sender)
CREATE POLICY "Senders can view own escrow holds"
  ON escrow_holds FOR SELECT
  USING (sender_wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));

-- Drivers can view escrow where they're the driver
CREATE POLICY "Drivers can view assigned escrow holds"
  ON escrow_holds FOR SELECT
  USING (driver_wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));

-- Users can view own payout requests
CREATE POLICY "Users can view own payouts"
  ON payout_requests FOR SELECT
  USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));

-- All mutations go through the API (service role) — no client-side inserts/updates
-- This prevents users from crediting their own wallets

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-create wallet when a user signs up
CREATE OR REPLACE FUNCTION create_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id, currency)
  VALUES (NEW.id, 'NGN')
  ON CONFLICT (user_id, currency) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created_create_wallet
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_wallet_for_new_user();

-- Updated_at trigger for wallets
CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_timestamp();
