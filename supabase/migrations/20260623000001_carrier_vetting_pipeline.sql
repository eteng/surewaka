-- supabase/migrations/20260623000001_carrier_vetting_pipeline.sql

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE carrier_application_status AS ENUM (
  'pending',
  'under_review',
  'approved',
  'rejected'
);

CREATE TYPE carrier_member_action AS ENUM (
  'invited',
  'joined',
  'role_changed',
  'suspended',
  'reactivated',
  'removed'
);

-- carrier_staff is added to the existing carrier_member_role enum.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in PG < 12;
-- Supabase runs migrations outside a transaction, so this is safe.
ALTER TYPE carrier_member_role ADD VALUE IF NOT EXISTS 'carrier_staff';

-- ── carrier_applications ───────────────────────────────────────────────────────

CREATE TABLE carrier_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name   text NOT NULL,
  contact_name    text NOT NULL,
  email           text NOT NULL,
  phone           text NOT NULL,
  cac_number      text,
  fleet_size      int,
  service_areas   jsonb NOT NULL DEFAULT '[]',
  notes           text,
  status          carrier_application_status NOT NULL DEFAULT 'pending',
  reviewed_by     uuid REFERENCES users(id),
  review_notes    text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_applications_status ON carrier_applications(status);
CREATE INDEX idx_carrier_applications_created_at ON carrier_applications(created_at DESC);

ALTER TABLE carrier_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_applications"
  ON carrier_applications FOR ALL USING (auth.role() = 'service_role');
GRANT INSERT ON carrier_applications TO authenticated;

-- ── carrier_application_events (append-only) ──────────────────────────────────

CREATE TABLE carrier_application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES carrier_applications(id),
  from_status     carrier_application_status,
  to_status       carrier_application_status NOT NULL,
  performed_by    uuid REFERENCES users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_application_events_application
  ON carrier_application_events(application_id, created_at ASC);

ALTER TABLE carrier_application_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_application_events"
  ON carrier_application_events FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT ON carrier_application_events TO authenticated;

-- ── carrier_member_invitations ────────────────────────────────────────────────

CREATE TABLE carrier_member_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id    uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  phone         text,
  email         text,
  role          carrier_member_role NOT NULL,
  invited_by    uuid NOT NULL REFERENCES users(id),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_or_email_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_carrier_member_invitations_phone
  ON carrier_member_invitations(phone) WHERE phone IS NOT NULL AND accepted_at IS NULL;
CREATE INDEX idx_carrier_member_invitations_email
  ON carrier_member_invitations(email) WHERE email IS NOT NULL AND accepted_at IS NULL;

ALTER TABLE carrier_member_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_member_invitations"
  ON carrier_member_invitations FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT ON carrier_member_invitations TO authenticated;

-- ── carrier_member_events (append-only) ───────────────────────────────────────

CREATE TABLE carrier_member_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id      uuid NOT NULL REFERENCES carriers(id),
  target_user_id  uuid REFERENCES users(id),
  action          carrier_member_action NOT NULL,
  role            carrier_member_role NOT NULL,
  performed_by    uuid REFERENCES users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_member_events_carrier
  ON carrier_member_events(carrier_id, created_at DESC);

ALTER TABLE carrier_member_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_member_events"
  ON carrier_member_events FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT ON carrier_member_events TO authenticated;

-- ── Update carriers table ─────────────────────────────────────────────────────

ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS driver_vetting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES carrier_applications(id);
