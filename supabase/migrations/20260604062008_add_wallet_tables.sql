-- ENUMS
CREATE TYPE wallet_status AS ENUM ('active', 'frozen', 'closed');

CREATE TYPE transaction_type AS ENUM (
  'fund',
  'escrow_hold',
  'escrow_release',
  'refund',
  'payout',
  'commission',
  'adjustment'
);

CREATE TYPE escrow_status AS ENUM (
  'held',
  'released',
  'refunded',
  'disputed',
  'partially_refunded'
);

-- WALLETS
CREATE TABLE public.wallets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance           BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency          TEXT NOT NULL DEFAULT 'NGN',
  status            wallet_status NOT NULL DEFAULT 'active',
  dva_bank          TEXT,
  dva_account_no    TEXT,
  dva_customer_code TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, currency)
);

CREATE INDEX idx_wallets_user_id ON public.wallets(user_id);

-- WALLET TRANSACTIONS (append-only ledger)
CREATE TABLE public.wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES public.wallets(id),
  type          transaction_type NOT NULL,
  amount        BIGINT NOT NULL CHECK (amount <> 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  reference     TEXT UNIQUE,
  description   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_transactions_wallet_id      ON public.wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_transactions_wallet_created ON public.wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX idx_wallet_transactions_reference      ON public.wallet_transactions(reference);
CREATE INDEX idx_wallet_transactions_type        ON public.wallet_transactions(type);
CREATE INDEX idx_wallet_transactions_created_at  ON public.wallet_transactions(created_at DESC);

-- ESCROW HOLDS
CREATE TABLE public.escrow_holds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       UUID NOT NULL REFERENCES public.deliveries(id),
  sender_wallet_id  UUID NOT NULL REFERENCES public.wallets(id),
  driver_wallet_id  UUID REFERENCES public.wallets(id),
  total_amount      BIGINT NOT NULL CHECK (total_amount > 0),
  commission_rate   NUMERIC(5,4) NOT NULL DEFAULT 0.1500,
  commission_amount BIGINT NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  driver_amount     BIGINT NOT NULL DEFAULT 0 CHECK (driver_amount >= 0),
  status            escrow_status NOT NULL DEFAULT 'held',
  held_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at       TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_escrow_holds_delivery_id     ON public.escrow_holds(delivery_id);
CREATE INDEX idx_escrow_holds_status          ON public.escrow_holds(status);
CREATE INDEX idx_escrow_holds_sender_wallet   ON public.escrow_holds(sender_wallet_id);

-- PAYOUT REQUESTS
CREATE TABLE public.payout_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id                UUID NOT NULL REFERENCES public.wallets(id),
  amount                   BIGINT NOT NULL CHECK (amount > 0),
  bank_code                TEXT NOT NULL,
  account_number           TEXT NOT NULL,
  account_name             TEXT NOT NULL,
  paystack_transfer_code   TEXT,
  paystack_recipient_code  TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  failure_reason           TEXT,
  processed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payout_requests_wallet_id ON public.payout_requests(wallet_id);
CREATE INDEX idx_payout_requests_status    ON public.payout_requests(status);

-- AUTO-CREATE WALLET ON USER SIGNUP
CREATE OR REPLACE FUNCTION public.create_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id, currency)
  VALUES (NEW.id, 'NGN')
  ON CONFLICT (user_id, currency) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

CREATE TRIGGER on_user_created_create_wallet
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_wallet_for_new_user();

-- UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION public.update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_wallet_timestamp();

-- RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_manage_wallets"
  ON public.wallets FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_read_own_wallet"
  ON public.wallets FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "service_role_manage_wallet_transactions"
  ON public.wallet_transactions FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_read_own_wallet_transactions"
  ON public.wallet_transactions FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

CREATE POLICY "service_role_manage_escrow_holds"
  ON public.escrow_holds FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "senders_read_own_escrow"
  ON public.escrow_holds FOR SELECT USING (sender_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

CREATE POLICY "service_role_manage_payout_requests"
  ON public.payout_requests FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "users_read_own_payout_requests"
  ON public.payout_requests FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT SELECT ON public.escrow_holds TO authenticated;
GRANT SELECT ON public.payout_requests TO authenticated;
