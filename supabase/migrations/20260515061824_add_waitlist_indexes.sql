-- Support sorting by created_at (default sort)
CREATE INDEX idx_waitlist_signups_created_at ON waitlist_signups (created_at DESC);

-- Support filtering by user_type + sorting by created_at
CREATE INDEX idx_waitlist_signups_user_type_created_at ON waitlist_signups (user_type, created_at DESC);

-- Support filtering by source
CREATE INDEX idx_waitlist_signups_source ON waitlist_signups (source);

-- Support search on email (for ILIKE queries)
CREATE INDEX idx_waitlist_signups_email ON waitlist_signups (email);

-- Support search on full_name (trigram index for ILIKE)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_waitlist_signups_full_name_trgm ON waitlist_signups USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_waitlist_signups_email_trgm ON waitlist_signups USING gin (email gin_trgm_ops);;
