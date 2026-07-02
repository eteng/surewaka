-- ─── delivery_legs ────────────────────────────────────────────────────────────
CREATE TABLE delivery_legs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_number      smallint NOT NULL CHECK (leg_number BETWEEN 1 AND 10),
  leg_type        text NOT NULL CHECK (leg_type IN ('first_mile', 'intercity', 'last_mile')),
  actor_type      text NOT NULL CHECK (actor_type IN ('driver', 'carrier')),
  actor_id        uuid NOT NULL,
  pickup_address  text NOT NULL,
  pickup_lat      real NOT NULL,
  pickup_lng      real NOT NULL,
  pickup_zone     text,
  dropoff_address text NOT NULL,
  dropoff_lat     real NOT NULL,
  dropoff_lng     real NOT NULL,
  dropoff_zone    text,
  status          delivery_status NOT NULL DEFAULT 'pending',
  system_eta_at   timestamptz,
  driver_eta_at   timestamptz,
  sla_hours       real,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, leg_number)
);

CREATE INDEX idx_delivery_legs_delivery_id ON delivery_legs(delivery_id);
CREATE INDEX idx_delivery_legs_actor_id    ON delivery_legs(actor_id);
CREATE INDEX idx_delivery_legs_status      ON delivery_legs(status) WHERE status NOT IN ('delivered', 'cancelled', 'failed', 'returned');

-- ─── delivery_events ──────────────────────────────────────────────────────────
CREATE TABLE delivery_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_id        uuid REFERENCES delivery_legs(id) ON DELETE SET NULL,
  from_status   delivery_status,
  to_status     delivery_status NOT NULL,
  triggered_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  failure_cause text CHECK (failure_cause IN ('driver', 'carrier', 'route_traffic', 'system')),
  failure_note  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_events_delivery_id ON delivery_events(delivery_id);
CREATE INDEX idx_delivery_events_leg_id      ON delivery_events(leg_id);
CREATE INDEX idx_delivery_events_created_at  ON delivery_events(created_at DESC);

-- ─── Trigger: auto-log leg status changes ────────────────────────────────────
CREATE OR REPLACE FUNCTION log_leg_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status)
    VALUES (NEW.delivery_id, NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leg_status_change
  AFTER UPDATE OF status ON delivery_legs
  FOR EACH ROW EXECUTE FUNCTION log_leg_status_change();

-- ─── driver_locations ─────────────────────────────────────────────────────────
CREATE TABLE driver_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  lat         real NOT NULL,
  lng         real NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_locations_driver_recent
  ON driver_locations(driver_id, recorded_at DESC);
CREATE INDEX idx_driver_locations_delivery_id
  ON driver_locations(delivery_id) WHERE delivery_id IS NOT NULL;

-- ─── delivery_ratings ─────────────────────────────────────────────────────────
CREATE TABLE delivery_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES drivers(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, customer_id)
);

CREATE INDEX idx_delivery_ratings_driver_id ON delivery_ratings(driver_id);

-- Trigger: keep drivers.rating aggregate in sync
CREATE OR REPLACE FUNCTION sync_driver_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE drivers
  SET rating = (
    SELECT ROUND(AVG(rating)::numeric, 2)
    FROM delivery_ratings
    WHERE driver_id = COALESCE(NEW.driver_id, OLD.driver_id)
  )
  WHERE id = COALESCE(NEW.driver_id, OLD.driver_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_driver_rating
  AFTER INSERT OR UPDATE OR DELETE ON delivery_ratings
  FOR EACH ROW EXECUTE FUNCTION sync_driver_rating();

-- ─── carrier_sla_overrides ────────────────────────────────────────────────────
CREATE TABLE carrier_sla_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id       uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  origin_zone      text NOT NULL,
  destination_zone text NOT NULL,
  sla_hours        real NOT NULL CHECK (sla_hours > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, origin_zone, destination_zone)
);

-- ─── ETA columns on deliveries ────────────────────────────────────────────────
ALTER TABLE deliveries
  ADD COLUMN system_eta_at timestamptz,
  ADD COLUMN driver_eta_at timestamptz;

-- ─── RLS: delivery_legs ───────────────────────────────────────────────────────
ALTER TABLE delivery_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_delivery_legs"
  ON delivery_legs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "customers_read_own_delivery_legs"
  ON delivery_legs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.id = delivery_legs.delivery_id
        AND d.customer_id = auth.uid()
    )
  );

GRANT SELECT ON delivery_legs TO authenticated;

-- ─── RLS: delivery_events ─────────────────────────────────────────────────────
ALTER TABLE delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_delivery_events"
  ON delivery_events FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "customers_read_own_delivery_events"
  ON delivery_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.id = delivery_events.delivery_id
        AND d.customer_id = auth.uid()
    )
  );

GRANT SELECT ON delivery_events TO authenticated;

-- ─── RLS: driver_locations ────────────────────────────────────────────────────
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_driver_locations"
  ON driver_locations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "drivers_insert_own_location"
  ON driver_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drivers dr
      WHERE dr.id = driver_locations.driver_id
        AND dr.user_id = auth.uid()
    )
  );

GRANT INSERT ON driver_locations TO authenticated;

-- ─── RLS: delivery_ratings ────────────────────────────────────────────────────
ALTER TABLE delivery_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_delivery_ratings"
  ON delivery_ratings FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "customers_insert_own_rating"
  ON delivery_ratings FOR INSERT
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "customers_read_own_ratings"
  ON delivery_ratings FOR SELECT
  USING (customer_id = auth.uid());

GRANT SELECT, INSERT ON delivery_ratings TO authenticated;

-- ─── RLS: carrier_sla_overrides ───────────────────────────────────────────────
ALTER TABLE carrier_sla_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_carrier_sla_overrides"
  ON carrier_sla_overrides FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT ON carrier_sla_overrides TO authenticated;
