-- Add profile columns to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS notification_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_sms boolean NOT NULL DEFAULT true;

-- Create name_change_status enum
CREATE TYPE name_change_status AS ENUM ('pending', 'approved', 'rejected');

-- Create name_change_requests table
CREATE TABLE public.name_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_name text NOT NULL,
  requested_name text NOT NULL,
  reason text NOT NULL,
  status name_change_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_name_change_requests_status ON public.name_change_requests(status);
CREATE INDEX idx_name_change_requests_user ON public.name_change_requests(user_id);;
