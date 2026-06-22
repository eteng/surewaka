-- Create push_tokens table for Expo push notification token management
CREATE TABLE public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  app TEXT NOT NULL CHECK (app IN ('customer', 'driver')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial indexes for efficient token lookups (only active tokens)
CREATE INDEX idx_push_tokens_user_active
  ON public.push_tokens (user_id, is_active)
  WHERE is_active = true;

CREATE INDEX idx_push_tokens_user_app_active
  ON public.push_tokens (user_id, app, is_active)
  WHERE is_active = true;

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_push_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_push_tokens_updated_at();

-- Add notification_push preference column to users table
ALTER TABLE public.users
  ADD COLUMN notification_push BOOLEAN NOT NULL DEFAULT true;
