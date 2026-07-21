# Routing Worker — Requirements

## Context

"SureWaka way" is the third delivery mode: the customer delegates carrier selection entirely
to SureWaka, and the system finds the cheapest intercity path across all active carrier
routes — possibly chaining more than one intercity leg when no direct route exists.

This requires:
1. A `carrier_routes` table representing city-to-city routes each carrier offers
2. A routing engine that solves cheapest-path on that graph
3. An async BullMQ worker that computes the route and creates legs + quotes atomically
4. A new `pending_routing` delivery status while the worker runs
5. An Ably event so the mobile app gets the result without polling

In-city on-demand (`first_mile` single leg) is **unaffected** — it bypasses routing entirely.
`carrier_direct` mode (customer explicitly picks a carrier) is **unaffected** — legs are
already explicit in the request.

---

## User Stories

### REQ-1 — Carrier park and route catalogue

WHEN a SureWaka admin registers a carrier park (the physical terminal/motor-park a carrier operates from in a given city),  
THEN that park record stores the real address and coordinates used to compute first/last-mile distances.

WHEN an admin registers a carrier route (origin park → destination park, price, transit hours),  
THEN that route is stored and becomes an edge in the city graph used by the routing engine.

Acceptance criteria:
- A park has carrier FK, city slug, name (e.g. "GIG Lagos Terminal, Jibowu"), address, lat, lng
- A carrier may have more than one park in the same city (e.g. Jibowu and Ojota in Lagos); uniqueness is on `(carrier_id, name)`, not `(carrier_id, city)`
- A route references origin_park_id + destination_park_id (not raw city text); city is derived from the park
- Routes can be activated / deactivated without deletion (soft disable)
- A carrier can have multiple routes; the same city pair can be served by multiple carriers
- Routes are directional — Lagos→Abuja and Abuja→Lagos are separate rows (prices may differ)

### REQ-2 — "SureWaka way" delivery creation

WHEN a customer submits a delivery with `mode: "surewaka_way"` and pickup_city ≠ dropoff_city,  
THEN the API creates the delivery record immediately and returns a 202 response,  
THEN a routing job is enqueued and processed asynchronously.

WHEN pickup_city === dropoff_city and mode is `surewaka_way`,  
THEN the API rejects with 422 (in-city on-demand must use `mode: "on_demand"`).

Acceptance criteria:
- Delivery is created with `status: "pending_routing"` and `delivery_mode: "surewaka_way"`
- 202 response contains `{ deliveryId, status: "pending_routing" }` — no quote yet
- Existing synchronous paths (`on_demand`, `carrier_direct`) are unaffected

### REQ-2b — Carrier departure schedules

WHEN an admin configures departure slots for a route (e.g. 6AM and 2PM daily),  
THEN those slots define when the carrier physically departs from the origin park.

WHEN a departure slot has `daysOfWeek` set,  
THEN the slot is only valid on those ISO weekdays (1=Mon…7=Sun).

Acceptance criteria:
- A route can have zero or more active departure slots
- A route with zero active slots is excluded from the routing graph (cannot be routed through until slots are added)
- All departure times are stored and computed in West Africa Time (WAT = UTC+1)

### REQ-3 — Route graph and cheapest-path engine

WHEN the routing worker picks up a `route-delivery` job,  
THEN it loads all active carrier routes and builds a weighted directed city graph,  
THEN it runs a cheapest-path search (Dijkstra) from pickup_city to dropoff_city,  
THEN it selects the path with the lowest composite intercity cost (carrier base + SureWaka commission),  
THEN it creates delivery legs and authoritative quotes for the full itinerary atomically.

Acceptance criteria:
- Direct routes (1 intercity hop) are always preferred over multi-hop paths of equal or higher cost; multi-hop is only evaluated when no direct route exists
- Max 3 intercity hops (4 cities total) — paths beyond this are rejected as infeasible
- For each intercity hop the engine computes the next departure slot >= arrival at that park (including transfer time from the previous park); if the carrier has no available slot it skips that edge
- Arrival time at intermediate parks propagates forward: if a package arrives at a mid-park at 4PM and the only slot is 6AM, it waits until 6AM next day
- Multi-hop paths include a `transfer` leg between consecutive intercity legs — a park-to-park on-demand driver leg within the intermediate city
- Transfer leg timing (haversine distance between parks / avg speed) is factored into the `nextDeparture` calculation for the next intercity hop
- If multiple paths tie on cost, prefer fewest hops, then earliest `estimatedDeliveryAt`
- On-demand `first_mile` and `last_mile` legs always wrap the intercity chain
- All legs (including transfer legs) and quotes are inserted in a single DB transaction; delivery status → `draft` on success
- The engine is a pure function — no DB inside

### REQ-4 — Routing failure handling

WHEN no active route exists between the requested cities within the hop limit,  
THEN the delivery status is set to `routing_failed`,  
THEN an Ably `routing_failed` event is published on the delivery's channel.

WHEN the routing worker throws an infrastructure error (DB down, Redis unavailable),  
THEN BullMQ retries up to 3 times with exponential backoff before moving to the dead-letter queue.

Acceptance criteria:
- `NO_ROUTE_FOUND` is a clean failure (not a BullMQ retry — it's deterministic)
- Infrastructure failures do retry — they're transient
- Failed delivery stays accessible via the existing delivery detail API; status is `routing_failed`

### REQ-5 — Real-time routing result delivery

WHEN routing completes successfully,  
THEN an Ably `routed` event is published on channel `delivery:{deliveryId}` with the composite quote,  
THEN the mobile customer app receives the quote and transitions from the "pending routing" screen.

WHEN routing fails,  
THEN an Ably `routing_failed` event is published on the same channel,  
THEN the mobile app shows an error with a fallback option to manually pick a carrier.

Acceptance criteria:
- Ably publish uses the existing `@surewaka/realtime` package — no new Ably dependency
- The routed event payload matches the same quote shape returned by the synchronous `POST /deliveries` path
- Mobile app subscribes immediately after receiving the 202 from delivery creation

### REQ-5b — Cancellation policy enforcement

WHEN a customer cancels a `surewaka_way` delivery in `draft` status (route computed, not yet paid),  
THEN the cancellation is free — no refund is owed because no escrow exists.

WHEN a customer cancels a `surewaka_way` delivery in `pending` status before `cancellationDeadlineAt`,  
THEN a full refund is issued — they are within the free-cancellation window.

WHEN a customer cancels after `cancellationDeadlineAt` (or fails to show up within 15 minutes),  
THEN a cancellation fee equal to the first intercity leg's confirmed quote price is deducted;  
THEN the remainder is refunded to the customer wallet;  
THEN the fee is recorded as a `commission` platform ledger event (SureWaka keeps it).

WHEN a customer cancels a `pending_routing` delivery (routing not yet complete, no payment),  
THEN the cancellation is free with no refund.

Acceptance criteria:
- `draft` is no longer non-cancellable for `surewaka_way` deliveries
- The cancellation fee is the first `intercity` leg's active quote `totalKobo`
- The fee goes to the platform via a `commission` ledger event; no carrier wallet transfer
- `on_demand` and `carrier_direct` deliveries without `cancellationDeadlineAt` are unaffected — existing `REFUND_RATES` logic applies

### REQ-6 — Admin carrier route management (API only)

WHEN a SureWaka admin calls `POST /api/v1/admin/carrier-routes`,  
THEN a new carrier route is created.

WHEN an admin calls `PATCH /api/v1/admin/carrier-routes/:id`,  
THEN the route's price, transit hours, max weight, or active status can be updated.

WHEN an admin calls `GET /api/v1/admin/carrier-routes?carrierId=<id>`,  
THEN all routes for that carrier are returned (active and inactive).

Acceptance criteria:
- Only `surewaka_admin` role can call these endpoints
- `GET /api/v1/carrier-routes?fromCity=<>&toCity=<>` is a public (authenticated) endpoint returning active routes for a city pair — used by the carrier selection screen (REQ-7)

### REQ-7 — Carrier selection screen uses live route data

WHEN a customer opens the carrier selection screen for an intercity delivery,  
THEN active carrier routes for the selected city pair are fetched from the API,  
THEN the screen shows real carrier names, prices, and transit times — no hardcoded values.

Acceptance criteria:
- `GET /api/v1/carrier-routes?fromCity=<>&toCity=<>` returns `{ carrierId, carrierName, basePriceKobo, estimatedTransitHours }[]`
- The existing `POST /api/v1/booking/quote` is used alongside this to compute full speculative quotes per carrier
