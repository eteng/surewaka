-- Drop the overly-permissive policy
DROP POLICY IF EXISTS "customers_insert_own_rating" ON delivery_ratings;

-- Recreate with ownership check + driver participation check
CREATE POLICY "customers_insert_own_rating"
  ON delivery_ratings FOR INSERT
  WITH CHECK (
    customer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.id = delivery_ratings.delivery_id
        AND d.customer_id = auth.uid()
    )
    AND (
      driver_id IS NULL OR EXISTS (
        SELECT 1 FROM delivery_legs l
        WHERE l.delivery_id = delivery_ratings.delivery_id
          AND l.actor_type = 'driver'
          AND l.actor_id = delivery_ratings.driver_id
      )
    )
  );
