
## User

At the moment how is realtime handled?

## Kiro

Based on the project context, realtime is handled via **Ably** through an abstraction layer in `packages/realtime`.

## Current Setup

- **Provider:** Ably (free tier — 6M messages/month, 200 concurrent connections)
- **Package:** `packages/realtime` — a provider abstraction designed to be swappable (future migration target: Cloudflare Durable Objects)

## Channel Patterns

| Channel | Purpose | Characteristics |
|---------|---------|----------------|
| `delivery:${deliveryId}` | Delivery status updates | API publishes after DB mutation |
| `driver-location:${driverId}` | Driver location broadcasts | High frequency, no DB write |

## How it works

- **Server-side:** The API calls `getRealtime().publish(channel, event, data)` from route handlers after mutating the database
- **Client-side:** Mobile and web apps call `subscribe(channel, event, callback)` to listen for updates

## Architecture Notes

- The abstraction layer means the consuming code doesn't depend on Ably directly — it goes through the `packages/realtime` interface
- Location updates are fire-and-forget (no persistence), while delivery status changes are published after a confirmed DB write
- The free tier limits (200 concurrent connections) are fine for launch but will need upgrading as driver/customer counts grow

Want me to look at the actual implementation in `packages/realtime` for more detail?



## User

when build driver matching which is best for Location Data — Where to store high-frequency GPS updates?

## Kiro

# Location Data Storage for Driver Matching

High-frequency GPS updates (every 1–5 seconds per active driver) have unique requirements: high write throughput, fast spatial queries, short TTL (stale locations are useless), and the data is ephemeral — you don't need to persist a driver's location from 30 seconds ago.

## Options Compared

| Solution | Writes/sec | Spatial Query | Latency | Cost at 50 drivers | Cost at 500 drivers |
|----------|-----------|---------------|---------|--------------------|--------------------|
| **Redis (Geospatial)** | 100K+ | `GEORADIUS` / `GEOSEARCH` native | <1ms | ~$0 (existing Docker) | $15–30/month (Upstash/managed) |
| **Postgres (PostGIS)** | ~5K | ST_DWithin, spatial indexes | 5–20ms | $0 (existing Neon) | $0 (but adds load) |
| **Cloudflare DO** | Per-object | Custom logic | 5–50ms | <$1 | $5–10 |
| **In-memory (app process)** | Unlimited | Custom | <0.1ms | $0 | $0 (but no horizontal scale) |
| **DynamoDB** | 25K+ | Geohash + query | 5–10ms | $2–5 | $10–30 |

## Recommendation: Redis Geospatial

**Redis is the clear winner for this use case.** Here's why:

### How it works

```
GEOADD drivers:active <longitude> <latitude> <driverId>
GEOSEARCH drivers:active FROMLONLAT <lng> <lat> BYRADIUS 5 km ASC COUNT 20
```

That's it. Two commands give you the entire matching foundation.

### Why Redis over the others

**vs Postgres/PostGIS:**
- GPS writes every 1–5s per driver would hammer Neon with write-heavy ephemeral data
- You'd pay for WAL storage on data you don't need to persist
- Neon's serverless model has connection/compute costs per query — bad for high-frequency writes
- PostGIS is great for geospatial *analytics*, overkill for "where are drivers right now?"

**vs Cloudflare DO:**
- DOs are per-object actors — you'd need to build a coordination layer to answer "find all drivers near point X"
- No native spatial indexing; you'd implement geohashing yourself
- Good for per-driver state, bad for cross-driver spatial queries

**vs In-memory:**
- Works at tiny scale but dies the moment you have >1 API instance
- No persistence across deploys

**vs DynamoDB:**
- Requires geohash-based partition key design (complex)
- Higher latency than Redis
- More expensive for this access pattern

### Architecture for SureWaka

```
┌─────────────┐     every 3s      ┌─────────────┐
│ Driver App  │ ──────────────────▶│  API (Hono) │
│  (Expo)     │   POST /location   │             │
└─────────────┘                    └──────┬──────┘
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                 ▼
                  ┌────────────┐  ┌─────────────┐  ┌──────────────┐
                  │   Redis    │  │   Ably      │  │  Neon (only  │
                  │  GEOADD    │  │  Publish    │  │  on accept/  │
                  │            │  │  location   │  │  complete)   │
                  └────────────┘  └─────────────┘  └──────────────┘
                        │
                        ▼  (when matching triggered)
                  ┌────────────┐
                  │ GEOSEARCH  │ → top N drivers within radius
                  │ + filter   │ → check availability, vehicle type
                  └────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Write frequency** | Every 3s while online | Balance between accuracy and cost |
| **TTL** | 30s expiry per driver | Auto-removes offline drivers |
| **Persistence** | None needed | Location is ephemeral; only the latest matters |
| **DB writes** | Only on delivery events | Accept, pickup, deliver → write to Neon |
| **Ably publish** | On every update | Customer sees live driver movement |
| **Redis structure** | Single sorted set `drivers:active` | Simple, fast, one GEOSEARCH scans all |

### TTL Strategy

Redis GEOADD doesn't support per-member TTL natively. Two patterns:

**Option A — Companion key (simple):**
```
GEOADD drivers:active <lng> <lat> <driverId>
SET driver:loc:<driverId> 1 EX 30   ← expires in 30s
```
Before matching, verify the companion key exists. A background job periodically prunes stale entries from the geo set.

**Option B — Timestamp in sorted set (no extra keys):**
```
GEOADD drivers:active <lng> <lat> <driverId>
HSET driver:meta:<driverId> lastSeen <timestamp> status available vehicle motorcycle
```
At query time, filter out drivers whose `lastSeen` is >30s ago.

Option B is better — you need the metadata hash anyway for filtering (vehicle type, availability status).

### What you already have

You already run Redis via Docker (`docker compose -f infra/docker/docker-compose.yml up -d`) for BullMQ workers. So this adds zero infrastructure cost in dev. For production on Fly.io, you'd either:

- Add Upstash Redis (serverless, geo-replicated, ~$10–30/month at scale) — **recommended**
- Or run a Redis Fly Machine in the same region as your API (~$5/month for a small instance)

### Implementation Sketch

```typescript
// packages/realtime/src/location-store.ts (or apps/api/src/lib/location/)
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const GEO_KEY = 'drivers:active';
const META_PREFIX = 'driver:meta:';

export async function updateDriverLocation(
  driverId: string,
  lng: number,
  lat: number,
  meta: { status: string; vehicleType: string }
) {
  await Promise.all([
    redis.geoadd(GEO_KEY, lng, lat, driverId),
    redis.hset(`${META_PREFIX}${driverId}`, {
      lastSeen: Date.now().toString(),
      status: meta.status,
      vehicleType: meta.vehicleType,
    }),
  ]);
}

export async function findNearbyDrivers(
  lng: number,
  lat: number,
  radiusKm: number,
  filters?: { vehicleType?: string }
): Promise<string[]> {
  const results = await redis.geosearch(
    GEO_KEY,
    'FROMLONLAT', lng, lat,
    'BYRADIUS', radiusKm, 'km',
    'ASC',
    'COUNT', 50
  );

  // Filter by freshness and criteria
  const now = Date.now();
  const eligible: string[] = [];

  for (const driverId of results) {
    const meta = await redis.hgetall(`${META_PREFIX}${driverId}`);
    if (!meta.lastSeen) continue;
    if (now - parseInt(meta.lastSeen) > 30_000) continue; // stale
    if (meta.status !== 'available') continue;
    if (filters?.vehicleType && meta.vehicleType !== filters.vehicleType) continue;
    eligible.push(driverId);
  }

  return eligible;
}

export async function removeDriver(driverId: string) {
  await Promise.all([
    redis.zrem(GEO_KEY, driverId),
    redis.del(`${META_PREFIX}${driverId}`),
  ]);
}
```

## Summary

| Question | Answer |
|----------|--------|
| Where to store GPS updates? | **Redis geospatial** |
| Why not Postgres? | Too heavy for ephemeral high-frequency writes; wrong tool |
| Why not Cloudflare DO? | No spatial queries; complex coordination needed |
| Infrastructure cost? | $0 extra in dev (existing Redis), $10–30/month in prod |
| Engineering effort? | Small — Redis geo commands are simple; 1–2 days to implement |

## User

what about matching strategy?

## Kiro

Now I have a full picture of where SureWaka stands. The matching system hasn't been built yet — it's referenced as a future concern. Let me lay out the strategy.

# Driver Matching Strategy for SureWaka

## Context

Your delivery workflow already defines the skeleton: broadcast to nearby drivers → wait for accept (10 min timeout) → proceed or cancel. The missing piece is the **matching algorithm** — how you select which drivers to notify, in what order, and how to handle contention.

---

## Three Common Strategies

| Strategy | How it works | Best for |
|----------|-------------|----------|
| **Broadcast (first-accept-wins)** | Notify all nearby drivers simultaneously, first to tap "Accept" gets the job | Simple, fast, low-volume markets |
| **Sequential offer (ranked)** | Score and rank drivers, offer to #1 first, then #2 on timeout | Fair distribution, quality control |
| **Batch auction** | Collect bids from drivers within a window, select optimal match | High-volume, price-sensitive markets |

---

## Recommended: Hybrid — Broadcast with Ranked Priority

For SureWaka's Lagos launch, a pure broadcast with a scoring layer gives you the speed of broadcast with the fairness of ranking.

### How it works

```
Customer confirms booking
        │
        ▼
┌─────────────────────────────┐
│  1. GEOSEARCH nearby drivers │  (Redis, 5km radius)
│  2. Filter: available,       │
│     vehicle match, verified  │
│  3. Score & rank             │
│  4. Split into tiers         │
└──────────┬──────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼  (after 30s if no accept from Tier 1)
┌─────────┐  ┌─────────┐
│ Tier 1  │  │ Tier 2  │  → expand radius to 8km
│ Top 5   │  │ Next 10 │
│ drivers  │  │ drivers │
└────┬────┘  └────┬────┘
     │            │
     ▼            ▼  (after 60s if still no accept)
┌──────────────────────┐
│ Tier 3: ALL eligible │  → expand radius to 12km
│ (broadcast mode)     │
└──────────┬───────────┘
           │
           ▼  (after 5 min total if no accept)
    ┌──────────────┐
    │ Auto-cancel  │
    │ Refund sender│
    └──────────────┘
```

### Scoring Function

```typescript
type DriverScore = {
  driverId: string;
  score: number;
  distance: number;
};

function scoreDriver(driver: DriverCandidate, delivery: DeliveryRequest): number {
  let score = 100;

  // ─── Distance (most important) ──────────────────────────
  // Closer = higher score. Each km reduces score by 10.
  score -= driver.distanceKm * 10;

  // ─── Acceptance rate ────────────────────────────────────
  // Reward reliable drivers (range: 0.0 – 1.0)
  score += driver.acceptanceRate * 20;

  // ─── Completion rate ────────────────────────────────────
  // Penalize drivers who cancel after accepting
  score += driver.completionRate * 15;

  // ─── Rating ─────────────────────────────────────────────
  // 4.5+ stars get a boost
  if (driver.rating >= 4.5) score += 10;
  if (driver.rating < 4.0) score -= 15;

  // ─── Time since last job ────────────────────────────────
  // Fairness: idle drivers get a boost (prevents "rich get richer")
  const idleMinutes = (Date.now() - driver.lastJobCompletedAt) / 60_000;
  if (idleMinutes > 30) score += 10;
  if (idleMinutes > 60) score += 5; // diminishing

  // ─── Heading direction (optional, advanced) ─────────────
  // If driver is already heading toward pickup, boost
  if (driver.headingTowardPickup) score += 8;

  return Math.max(0, score);
}
```

### Why this scoring works for Lagos

| Factor | Rationale |
|--------|-----------|
| Distance weighted heavily | Lagos traffic means 2km extra = 20+ min extra wait |
| Acceptance rate rewarded | Drivers who ghost requests waste customer time |
| Idle time boost | Prevents top-rated drivers from monopolizing jobs; newer drivers get chances |
| No surge pricing (yet) | Keep it simple at launch; add dynamic pricing later |

---

## Contention Handling: First-Accept-Wins with Locking

When multiple drivers in the same tier see the offer simultaneously:

```typescript
async function acceptDelivery(driverId: string, deliveryId: string): Promise<boolean> {
  // Atomic lock — only one driver can claim
  const claimed = await redis.set(
    `delivery:lock:${deliveryId}`,
    driverId,
    'NX', // only set if not exists
    'EX', 300 // expire in 5 min (cleanup)
  );

  if (!claimed) {
    // Another driver already accepted
    return false;
  }

  // Proceed with assignment
  await db.update(deliveries)
    .set({ driverId, status: 'driver_assigned' })
    .where(eq(deliveries.id, deliveryId));

  // Cancel notifications to other drivers
  await cancelPendingOffers(deliveryId, driverId);

  // Send event to workflow
  await workflows.sendEvent(`delivery-${deliveryId}`, 'driver-accepted', { driverId });

  return true;
}
```

---

## Offer Lifecycle (per driver)

```
Push notification sent → Driver has 30s to respond
       │
       ├── Accept → lock check → assigned (or "already taken" if lost race)
       ├── Decline → mark declined, don't offer again for this delivery
       └── No response (30s) → expire, move to next tier
```

---

## Data Model Addition

You'll need a table to track offers per delivery:

```typescript
// packages/db/src/schema/delivery-offers.ts
export const deliveryOffers = pgTable('delivery_offers', {
  id: uuid('id').defaultRandom().primaryKey(),
  deliveryId: uuid('delivery_id').notNull().references(() => deliveries.id),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  tier: integer('tier').notNull(), // 1, 2, 3
  score: real('score').notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'declined', 'expired', 'cancelled'] })
    .notNull()
    .default('pending'),
  offeredAt: timestamp('offered_at').defaultNow().notNull(),
  respondedAt: timestamp('responded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

This gives you analytics: which drivers accept fastest, what radius works, tier conversion rates.

---

## Full Matching Flow (Implementation)

```typescript
// workers/matching/match-driver.ts (BullMQ job)

import { findNearbyDrivers } from '../../packages/realtime/src/location-store';

interface MatchJobData {
  deliveryId: string;
  pickupLng: number;
  pickupLat: number;
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
}

export async function matchDriver(data: MatchJobData) {
  const { deliveryId, pickupLng, pickupLat, vehicleType } = data;

  const tiers = [
    { radius: 5, count: 5, waitMs: 30_000 },
    { radius: 8, count: 10, waitMs: 30_000 },
    { radius: 12, count: 50, waitMs: 180_000 }, // 3 min for final tier
  ];

  for (const tier of tiers) {
    // 1. Find nearby drivers
    const nearby = await findNearbyDrivers(pickupLng, pickupLat, tier.radius, { vehicleType });

    if (nearby.length === 0) continue;

    // 2. Enrich with stats from DB
    const candidates = await enrichWithStats(nearby);

    // 3. Score and rank
    const ranked = candidates
      .map(d => ({ ...d, score: scoreDriver(d, data) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, tier.count);

    // 4. Send offers (push notifications)
    await sendOffers(deliveryId, ranked, tier.tier);

    // 5. Wait for acceptance
    const accepted = await waitForAcceptance(deliveryId, tier.waitMs);

    if (accepted) return { matched: true, driverId: accepted };
  }

  // No driver found across all tiers
  return { matched: false };
}
```

---

## Edge Cases to Handle

| Scenario | Solution |
|----------|----------|
| Driver accepts but goes offline immediately | 2-min "confirm en route" check; if no location update, reassign |
| Two deliveries compete for same driver | Redis lock is per-delivery; driver can only hold one active lock |
| Driver is already in Tier 1 for another delivery | Filter out drivers with `status !== 'available'` in Redis metadata |
| No drivers online at all | Immediate cancel + refund + suggest carrier option |
| Driver accepts then cancels | Penalize acceptance rate; trigger re-matching from Tier 1 |
| Customer cancels during matching | Send `cancelled` event; clean up all pending offers |
| Package requires specific vehicle but none nearby | Expand radius aggressively for rare vehicle types; notify customer of longer wait |

---

## Metrics to Track (for iteration)

| Metric | Why |
|--------|-----|
| Time-to-match (request → accept) | Core UX metric |
| Tier conversion rate | Are Tier 1 offers good enough? |
| Acceptance rate by time-of-day | Staffing/incentive planning |
| Average radius at match | Are drivers close enough? |
| Offer decline reasons | UX issues? Bad pricing? |
| Cancel-after-accept rate | Driver quality signal |

---

## When to Evolve

| Trigger | Evolution |
|---------|-----------|
| Match time consistently >2 min | Add incentive bonuses for Tier 1 |
| Certain areas have no drivers | Introduce surge pricing / guaranteed minimums |
| Drivers gaming the system (decline then accept Tier 3 for same distance) | Add cooldown per delivery |
| Volume exceeds 500 deliveries/day | Consider batch matching (every 10s, solve assignment as optimization problem) |
| Multi-stop deliveries | Offer to drivers already heading in the right direction first |

---

## Summary

| Decision | Choice |
|----------|--------|
| Strategy | Tiered broadcast with scoring |
| Scoring weights | Distance (heaviest) → reliability → fairness → rating |
| Contention | Redis `SET NX` atomic lock |
| Tier escalation | 5km/30s → 8km/30s → 12km/3min → cancel |
| Persistence | `delivery_offers` table for analytics |
| Runtime | BullMQ worker (existing infra) |
| Location source | Redis GEOSEARCH (from previous discussion) |

This gives you Uber/Bolt-level matching at launch without over-engineering. The scoring function and tier thresholds are tunable with data once you're live.

## User

so Geospatial Queries — How to find nearby drivers?, is from Redis?

## Kiro

Yes. Redis has **native geospatial commands** built on sorted sets. No extra plugins or extensions needed.

## How it works under the hood

Redis stores geo members in a sorted set using a **geohash** as the score (a 52-bit integer encoding of lat/lng). This gives you O(log(N) + M) spatial queries for free.

## The two commands you need

```bash
# Store/update a driver's location
GEOADD drivers:active <longitude> <latitude> <driverId>

# Find drivers near a pickup point
GEOSEARCH drivers:active FROMLONLAT <lng> <lat> BYRADIUS 5 km ASC COUNT 20
```

That's it. Redis handles the spatial indexing internally.

## Available geo commands

| Command | Purpose |
|---------|---------|
| `GEOADD` | Add/update a member's coordinates |
| `GEOSEARCH` | Find members within radius or bounding box |
| `GEODIST` | Distance between two members |
| `GEOPOS` | Get coordinates of a member |
| `GEOHASH` | Get the geohash string of a member |
| `ZREM` | Remove a member (it's just a sorted set) |

## Why Redis over PostGIS for this

| | Redis Geo | PostGIS (Neon) |
|---|---|---|
| Write speed | ~100K ops/sec | ~5K writes/sec |
| Query latency | <1ms | 5–20ms |
| Designed for | Ephemeral, high-frequency location data | Persistent geospatial analytics |
| TTL/expiry | Easy (companion keys or metadata) | Requires cleanup jobs |
| Infrastructure | You already run Redis for BullMQ | Already running for everything else |

Redis geo is purpose-built for "where are things right now?" — exactly the driver matching question. PostGIS is for "analyse all deliveries in Lekki last month" — different use case entirely.

## In your matching flow

```
Driver app (every 3s) → API → GEOADD drivers:active <lng> <lat> <driverId>
                                          │
Customer books delivery → matching worker → GEOSEARCH drivers:active FROMLONLAT <pickup> BYRADIUS 5 km
                                          │
                                          ▼
                                   [list of nearby driver IDs]
                                          │
                                          ▼
                                   Score → Rank → Offer
```

Redis gives you the candidate list. Your scoring function (distance, acceptance rate, idle time) decides the order. Two different concerns, cleanly separated.

## User

options on Neon Postgres?

## Kiro

## Geospatial Options on Neon Postgres

Yes, Neon supports geospatial queries. You have two options:

### Option 1: PostGIS Extension (full-featured)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add a geography column to drivers
ALTER TABLE drivers ADD COLUMN current_location geography(POINT, 4326);

-- Create spatial index
CREATE INDEX idx_drivers_location ON drivers USING GIST (current_location);

-- Find drivers within 5km of pickup
SELECT id, ST_Distance(current_location, ST_MakePoint(3.4219, 6.4541)::geography) AS distance_m
FROM drivers
WHERE ST_DWithin(current_location, ST_MakePoint(3.4219, 6.4541)::geography, 5000)
  AND status = 'available'
  AND vehicle_type = 'motorcycle'
ORDER BY distance_m
LIMIT 20;
```

### Option 2: earthdistance Extension (lightweight)

```sql
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Uses existing numeric lat/lng columns
SELECT id,
  (point(lng, lat) <@> point(3.4219, 6.4541)) * 1.609344 AS distance_km
FROM drivers
WHERE status = 'available'
  AND (point(lng, lat) <@> point(3.4219, 6.4541)) * 1.609344 < 5
ORDER BY distance_km
LIMIT 20;
```

---

## Comparison: Postgres Options vs Redis

| | PostGIS | earthdistance | Redis Geo |
|---|---|---|---|
| **Setup** | `CREATE EXTENSION postgis` | `CREATE EXTENSION earthdistance` | Already running |
| **Accuracy** | Exact (geodesic) | Approximate (great circle) | Approximate (geohash) |
| **Index type** | GiST R-tree (excellent) | B-tree on expression | Sorted set (geohash) |
| **Query latency** | 5–20ms | 10–30ms | <1ms |
| **Write throughput** | ~5K/sec (with WAL) | Same | ~100K/sec |
| **Cost on Neon** | Included (no extra charge) | Included | Separate service |
| **High-frequency writes** | ⚠️ Generates WAL, consumes compute | Same | ✅ Designed for this |
| **Neon sleep/wake** | Cold start penalty (~500ms) | Same | Always hot |

---

## The Real Problem with Postgres for Live Location

It's not that Postgres *can't* do it — it's that your usage pattern is hostile to Neon's architecture:

| Concern | Impact on Neon |
|---------|---------------|
| **50 drivers × 1 write/3s = 17 writes/sec** | Fine at launch |
| **500 drivers × 1 write/3s = 167 writes/sec** | Still fine technically |
| **Each write generates WAL** | You're paying for storage of ephemeral data you'll overwrite in 3 seconds |
| **Neon auto-scales down to zero** | Location writes keep compute alive 24/7 — no cost savings from scale-to-zero |
| **Serverless connection overhead** | Each write goes through Neon's proxy; adds 5–10ms vs Redis's sub-ms |
| **Compute hours** | Neon bills for active compute time; constant writes = constant billing |

---

## When Postgres-only makes sense

If you want to **eliminate Redis entirely** and keep the stack simpler:

| Scenario | Verdict |
|----------|---------|
| <50 active drivers | ✅ Postgres is fine. Latency acceptable. |
| You don't want another service to manage | ✅ Simplicity wins |
| You're on Neon's Pro plan with always-on compute | ✅ No cold start concern |
| 200+ active drivers, sub-second matching needed | ❌ Redis is clearly better |
| You already run Redis for BullMQ | ❌ Adding geo to existing Redis costs nothing |

---

## Pragmatic Recommendation

**You already run Redis for BullMQ.** Adding `GEOADD`/`GEOSEARCH` to it is literally zero infrastructure cost and zero operational overhead. The commands are simpler than SQL, faster, and purpose-built for this pattern.

Use Postgres/PostGIS for:
- Historical trip data ("show all deliveries in Lekki last week")
- Zone definitions (polygon-based, which you already have in your zone classifier)
- Driver home base / preferred areas (static, queried rarely)

Use Redis for:
- "Where are drivers RIGHT NOW?" (ephemeral, high-frequency, sub-ms response)

They complement each other — different tools for different time horizons.

## User

I have a driver_location how do i consolidate

## Kiro

Now I have the full picture. Here's how to consolidate:

# Consolidating `driver_locations` with Redis Geo

You have two concerns that look like one but are actually distinct:

## What you have now

```
Driver app → POST /api/v1/driver/location
                    │
                    ▼
        ┌──────────────────────┐
        │  INSERT INTO         │  ← Every ping goes to Postgres
        │  driver_locations    │
        │  (append-only log)   │
        └──────────────────────┘
                    │
                    ▼
            (no Ably publish currently — the route doesn't call getRealtime())
```

Your current route **only writes to Postgres**. It doesn't publish to Ably or update Redis. The Ably `driver-location:{driverId}` channel exists in the type definitions but isn't wired up in the route handler.

---

## The Two Concerns

| Concern | Purpose | Access pattern | Storage |
|---------|---------|----------------|---------|
| **"Where is this driver RIGHT NOW?"** | Matching, live tracking | Read latest, write every 3s | Redis (ephemeral) |
| **"Where WAS this driver during delivery X?"** | Disputes, ops alerts, audit trail | Read historical, append-only | Postgres (permanent) |

These are **different data stores for different reasons**. Don't collapse them into one.

---

## Consolidated Architecture

```
Driver app (every 3s)
        │
        ▼
POST /api/v1/driver/location
        │
        ├──→ Redis GEOADD drivers:active <lng> <lat> <driverId>     ← live position (matching)
        │    Redis HSET driver:meta:<driverId> lastSeen, status...   ← metadata for filtering
        │
        ├──→ Ably publish → driver-location:<driverId>               ← customer sees live map
        │
        └──→ Postgres INSERT driver_locations (only if on active delivery)
             ← audit trail for disputes/ops
```

---

## Updated Route

```typescript
// apps/api/src/routes/driver-locations.ts
import { Hono } from 'hono';
import { db, deliveries, driverLocations, drivers } from '@surewaka/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { recordDriverLocationSchema } from '@surewaka/shared';
import { getRealtime, CHANNELS, EVENTS } from '../lib/realtime';
import { redis } from '../lib/redis';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser } };

const GEO_KEY = 'drivers:active';
const META_PREFIX = 'driver:meta:';

const driverLocationRoutes = new Hono<Env>();
driverLocationRoutes.use('*', requireAuth);

driverLocationRoutes.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json();
  const parsed = recordDriverLocationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const { lat, lng, deliveryId } = parsed.data;

  // Resolve driver record
  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);

  if (!driver) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Driver profile not found' }, meta: null },
      404,
    );
  }

  // Validate delivery ownership if provided
  if (deliveryId) {
    const [delivery] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.driverId, driver.id)))
      .limit(1);

    if (!delivery) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Delivery not assigned to this driver' }, meta: null },
        403,
      );
    }
  }

  // ─── 1. Redis: Live position for matching ──────────────────
  await Promise.all([
    redis.geoadd(GEO_KEY, lng, lat, driver.id),
    redis.hset(`${META_PREFIX}${driver.id}`, {
      lastSeen: Date.now().toString(),
      lat: lat.toString(),
      lng: lng.toString(),
    }),
  ]);

  // ─── 2. Ably: Broadcast to tracking subscribers ───────────
  getRealtime().publish(
    CHANNELS.driverLocation(driver.id),
    EVENTS.locationUpdate,
    { lat, lng, timestamp: Date.now() },
  );

  // ─── 3. Postgres: Append to history (only during active delivery) ──
  if (deliveryId) {
    await db.insert(driverLocations).values({
      driverId: driver.id,
      deliveryId,
      lat,
      lng,
    });
  }

  return c.json({ data: { ok: true }, error: null, meta: null });
});

export default driverLocationRoutes;
```

---

## Key Changes from Current Code

| Before | After |
|--------|-------|
| Always writes to Postgres | Postgres only during active delivery |
| No Redis | Redis GEOADD + HSET on every ping |
| No Ably publish | Publishes to `driver-location:{driverId}` channel |
| Returns `{ id }` of inserted row | Returns `{ ok: true }` (no row when no delivery) |

---

## What each store gives you

### Redis (ephemeral, <1ms)
```bash
# Matching: "find 10 nearest available drivers"
GEOSEARCH drivers:active FROMLONLAT 3.4219 6.4541 BYRADIUS 5 km ASC COUNT 10

# Ops: "is this driver still alive?"
HGET driver:meta:<driverId> lastSeen

# Cleanup: driver goes offline
ZREM drivers:active <driverId>
DEL driver:meta:<driverId>
```

### Postgres (permanent, queryable)
```sql
-- Disputes: "show driver path during delivery X"
SELECT lat, lng, recorded_at
FROM driver_locations
WHERE delivery_id = $1
ORDER BY recorded_at;

-- Ops alerts: "last ping from this driver" (existing usage in ops-hub)
SELECT DISTINCT ON (driver_id) driver_id, recorded_at
FROM driver_locations
ORDER BY driver_id, recorded_at DESC;
```

### Ably (transient, real-time push)
```
Customer app subscribes → sees driver dot move on map
Admin ops hub subscribes → live fleet view
```

---

## What about your ops-hub queries?

Your `ops-hub.ts` does `DISTINCT ON (driver_id) ... FROM driver_locations ORDER BY recorded_at DESC` to check if a driver has gone silent. Two options:

**Option A (recommended):** Query Redis `HGET driver:meta:<driverId> lastSeen` instead — faster, always fresh. Update the ops-hub to use Redis for "is driver alive?" checks.

**Option B:** Keep the Postgres query as-is. Since you're still writing to `driver_locations` during active deliveries, the ops-hub query still works for drivers on a job (which is what it actually cares about — silent drivers mid-delivery).

Option B requires zero migration of the ops-hub code. The existing queries still work because drivers that matter (on active deliveries) still get Postgres writes.

---

## Summary

| Layer | Writes when | Read by | TTL |
|-------|-------------|---------|-----|
| **Redis** | Every ping (all drivers) | Matching worker, ops alerts | 30s (implicit via `lastSeen` check) |
| **Ably** | Every ping (all drivers) | Customer app, admin dashboard | Transient (no storage) |
| **Postgres** | Only during active delivery | Dispute resolution, audit, ops-hub | Forever (append-only) |

This gives you fast matching (Redis), live tracking (Ably), and an audit trail (Postgres) — each store doing what it's best at. Your existing `driver_locations` table stays, it just gets fewer writes (only during deliveries instead of 24/7).

## User

Where does the matching orchestration run

## Kiro

Based on your existing architecture, the matching orchestration runs in a **BullMQ worker**.

## Current setup

```
apps/api (Hono, Fly.io)  →  enqueues job  →  Redis (BullMQ)  →  Worker picks up job
```

You already have this pattern established:

| Component | Role |
|-----------|------|
| `workers/` directory | Background processors (email, payment, push, agent, cron) |
| BullMQ + Redis | Job queue (already running via Docker / production Redis) |
| Fly.io | Hosts both API and workers |

## Where matching fits

```
POST /api/v1/booking/confirm (Fly.io API)
        │
        ▼
  1. Create delivery in Postgres
  2. Hold escrow
  3. Trigger Vercel Workflow (delivery lifecycle)
        │
        ▼
  Workflow Step 1: "match-driver"
        │
        ▼
  Calls internal API: POST /api/v1/internal/deliveries/:id/broadcast
        │
        ▼
  API enqueues BullMQ job → "driver-matching" queue
        │
        ▼
  Worker (workers/matching/ on Fly.io):
    - GEOSEARCH Redis for nearby drivers
    - Score & rank
    - Send push notifications (tier 1)
    - Wait 30s → escalate to tier 2 if needed
    - On accept: Redis SET NX lock → send event to workflow
```

## Why BullMQ worker (not inline in API)

| Reason | Explanation |
|--------|-------------|
| **Time budget** | Matching can take 30s–5min (tier escalation). Can't hold an HTTP request open that long. |
| **Retries** | BullMQ gives you automatic retry with backoff if something fails mid-match |
| **Delayed jobs** | Tier escalation = schedule next tier as a delayed job (30s) |
| **Concurrency control** | Prevent double-matching via job deduplication |
| **Already exists** | Your worker infra is already deployed on Fly.io |

## The two orchestration layers

You actually have **two levels** working together:

```
┌────────────────────────────────────────────────────┐
│  Vercel Workflow (delivery-lifecycle)               │
│  - Long-lived (hours)                              │
│  - Waits for events (driver-accepted, picked-up)   │
│  - Handles timeouts, cancellation, escrow release  │
│  - Orchestrates the WHOLE delivery lifecycle       │
└───────────────────────┬────────────────────────────┘
                        │ triggers
                        ▼
┌────────────────────────────────────────────────────┐
│  BullMQ Worker (driver-matching)                   │
│  - Short-lived (seconds to minutes)               │
│  - GEOSEARCH → score → notify → wait for accept   │
│  - Handles tier escalation                         │
│  - Sends "driver-accepted" event back to workflow  │
└────────────────────────────────────────────────────┘
```

The **workflow** is the durable state machine (survives crashes, handles hours-long delivery). The **worker** is the tactical matching logic (fast, retryable, handles the 30s–5min matching window).

## File structure

```
workers/
├── email-worker/       ← exists
├── payment-worker/     ← exists
├── push-worker/        ← exists
├── agent-worker/       ← exists
├── cron/               ← exists
└── matching/           ← NEW
    ├── package.json
    ├── src/
    │   ├── index.ts           ← BullMQ worker setup
    │   ├── match-driver.ts    ← scoring, tier logic
    │   ├── find-nearby.ts     ← Redis GEOSEARCH wrapper
    │   └── notify-drivers.ts  ← push notification to driver app
    └── tsconfig.json
```

## Alternative: Could it run in the Vercel Workflow directly?

Your current `delivery-workflow.md` shows matching as a `ctx.run('match-driver', ...)` step that calls the internal API. That works for the **trigger**, but the actual tier escalation logic (wait 30s, expand radius, retry) is better in BullMQ because:

- Vercel Workflows charge per step execution
- `ctx.waitForEvent` with 30s granularity is wasteful for tier logic
- BullMQ delayed jobs are free (Redis-native)

Keep the workflow step as a thin trigger that enqueues the BullMQ job, and have the worker send the `driver-accepted` event back to the workflow when done.

## User

Redis provider — Upstash vs self-hosted on Fly.io?

## Kiro

# Upstash vs Self-Hosted Redis on Fly.io

## Your current setup

- **Dev:** Redis 7 Alpine via Docker Compose (local)
- **Production use:** BullMQ (push-worker, routing-worker, matching-worker) via `ioredis` connecting to `REDIS_URL`
- **Adding:** GEOADD/GEOSEARCH for driver matching

---

## Head-to-head

| | Upstash Redis | Self-hosted on Fly.io |
|---|---|---|
| **Type** | Serverless (HTTP + TCP) | Standard Redis in a Fly Machine |
| **Protocol** | REST API *or* native Redis protocol | Native Redis protocol (ioredis) |
| **Persistence** | Managed (durable by default) | You configure AOF/RDB |
| **Pricing model** | Per-command | Fixed monthly (Machine size) |
| **Free tier** | 10K commands/day | None (Fly Machines start at ~$3.50/mo) |
| **Geo commands** | ✅ Full Redis 7 support | ✅ Full Redis 7 support |
| **BullMQ compatible** | ✅ (via native TCP endpoint) | ✅ |
| **Connection limit** | 1,000 concurrent (paid) | Unlimited (limited by RAM) |
| **Latency** | 1–5ms (same region) | <1ms (same Fly private network) |
| **Multi-region** | ✅ Global read replicas built-in | Manual (run replica Machines) |
| **Failover** | Automatic | You manage (or use Fly HA, $$$) |
| **Backups** | Automatic | You script it |
| **Max memory** | 10GB (Pro) | Whatever you provision |
| **Eviction control** | Dashboard config | Full redis.conf control |

---

## Cost comparison for SureWaka

### Launch (50 active drivers, 200 deliveries/day)

| Workload | Commands/day | Upstash cost | Fly Redis cost |
|----------|-------------|-------------|----------------|
| BullMQ (push, routing, matching) | ~50K | ~$0.10/day | — |
| Driver location GEOADD (50 × 1/3s × 8hrs) | ~480K | ~$0.96/day | — |
| GEOSEARCH (200 matches × 3 tiers avg) | ~600 | negligible | — |
| HSET/HGET metadata | ~480K | ~$0.96/day | — |
| **Total** | ~1M/day | **~$60/month** | **$3.50–7/month** |

### Growth (500 drivers, 2000 deliveries/day)

| Workload | Commands/day | Upstash cost | Fly Redis cost |
|----------|-------------|-------------|----------------|
| BullMQ | ~200K | $0.40 | — |
| Driver location GEOADD | ~4.8M | $9.60 | — |
| GEOSEARCH + metadata | ~5M | $10.00 | — |
| **Total** | ~10M/day | **~$600/month** | **$7–14/month** |

Upstash's per-command pricing **destroys you at scale** with high-frequency location writes.

---

## The nuance: Upstash REST vs TCP

Upstash offers two connection modes:

| Mode | Latency | BullMQ? | GEOADD? | Best for |
|------|---------|---------|---------|----------|
| **REST (@upstash/redis)** | 5–15ms | ❌ No | ✅ | Serverless/edge (Vercel, CF Workers) |
| **TCP (native)** | 1–5ms | ✅ Yes | ✅ | Long-running servers (Fly.io) |

Since your API and workers run on Fly.io (persistent processes, not serverless), you'd use TCP mode anyway — which makes Upstash basically "managed Redis with per-command billing."

---

## Recommendation: Self-hosted on Fly.io

For your workload pattern (high-frequency writes from long-running servers), self-hosted wins:

### Why

1. **Cost predictable** — $3.50–7/month regardless of command volume. Location pings don't scale your bill.
2. **Lowest latency** — Same Fly private network as your API. Sub-millisecond. Critical for matching speed.
3. **No command tax** — BullMQ is chatty (polling, heartbeats). Upstash charges for every internal BullMQ command too.
4. **Full control** — Configure `maxmemory-policy`, persistence, Lua scripts for atomic matching operations.
5. **Simple** — It's just Redis. Same `ioredis` connection as dev, just different `REDIS_URL`.

### Setup on Fly.io

```bash
# Create a Fly app for Redis
fly apps create surewaka-redis --org surewaka

# Launch with a persistent volume
fly launch --image redis:7-alpine \
  --name surewaka-redis \
  --region lhr \
  --vm-size shared-cpu-1x \
  --vm-memory 256

# Attach a volume for persistence
fly volumes create redis_data --size 1 --region lhr --app surewaka-redis

# Set in your API/worker secrets
fly secrets set REDIS_URL="redis://surewaka-redis.internal:6379" --app surewaka-api
```

Cost: **~$3.50/month** (shared-cpu-1x, 256MB). Upgrade to 512MB or 1GB when needed (~$7–14/month).

---

## When Upstash makes sense instead

| Scenario | Why Upstash wins |
|----------|-----------------|
| Serverless compute (Vercel edge functions, CF Workers) | No persistent TCP connections; REST API needed |
| Global multi-region reads | Built-in read replicas in 30+ regions |
| Zero ops budget | No Machine management, no volume backups |
| Very low volume (<10K commands/day) | Free tier covers it |

None of these apply to SureWaka right now. Your API is a persistent Hono server on Fly.io.

---

## Risk mitigation for self-hosted

| Risk | Mitigation |
|------|-----------|
| Machine dies, data lost | Enable AOF persistence + daily volume snapshots (`fly volumes snapshots`) |
| No automatic failover | Acceptable at launch; add Fly Machine restart policy (`auto_stop_machines = false`) |
| Need HA later | Fly supports multi-Machine apps; add a replica when revenue justifies it |
| Outgrow single instance | At 500+ drivers you'll still be under 50MB of geo data; RAM isn't the constraint |

---

## Summary

| | Verdict |
|---|---|
| **Launch** | Self-hosted Fly.io Redis (~$3.50/month) |
| **Why not Upstash** | Per-command pricing × high-frequency location writes = 10–100x more expensive |
| **Migration path** | If you later need global edge reads (e.g., multi-city expansion with regional APIs), add Upstash as a read layer or switch then |
| **Effort** | ~30 min to set up on Fly. Same `ioredis` client, same `REDIS_URL` pattern |

## User

what about https://fly.io/docs/upstash/redis/#fixed-price-plans

## Kiro

Good catch. This changes the comparison significantly. Fly's Upstash integration offers **fixed-price plans** that eliminate the per-command billing problem.

## Revised Comparison: Fly Upstash Fixed Plans vs Self-Hosted

| | Upstash Fixed 250MB ($10/mo) | Self-hosted Fly Machine (~$3.50–7/mo) |
|---|---|---|
| **Price** | $10/month flat | ~$3.50/mo (shared-cpu-1x, 256MB) |
| **Max data** | 250 MB | Whatever RAM you provision |
| **Bandwidth** | 50 GB/month | Unlimited (internal network) |
| **HA** | ✅ Auto-replicated within region | ❌ Single instance (you manage restarts) |
| **Backups** | ✅ Automatic (Upstash manages) | ❌ You script volume snapshots |
| **Failover** | ✅ Automatic | ❌ Machine restart policy only |
| **Max commands/sec** | Unlimited (fixed plan) | Unlimited |
| **BullMQ compatible** | ✅ | ✅ |
| **GEOADD/GEOSEARCH** | ✅ | ✅ |
| **Connection** | Private IPv6 within Fly org | Private network (`.internal`) |
| **Latency** | 1–3ms (same region) | <1ms (same network) |
| **Ops burden** | Zero | Low but nonzero |
| **Read replicas** | +$5/region | Manual setup |
| **Eviction config** | Dashboard/CLI | Full redis.conf |

---

## Does 250MB suffice for your workload?

Let's estimate peak data size:

| Data | Size estimate |
|------|---------------|
| 500 drivers in geo set (`drivers:active`) | ~50KB |
| 500 driver metadata hashes | ~100KB |
| BullMQ queues (push, routing, matching) | ~5–20MB at peak |
| Delivery locks, transient keys | ~1MB |
| **Total** | **~25MB typical, ~50MB peak** |

250MB is more than enough. You'd only need the 1GB plan ($20/mo) if you start storing cached data or significantly more queue depth.

---

## Revised Recommendation

**Use Fly Upstash Fixed 250MB ($10/month).**

The $6.50/month premium over self-hosted buys you:

| What you get | Value |
|---|---|
| Automatic HA (within-region replication) | No data loss if hardware fails |
| Automatic backups | No scripting volume snapshots |
| Zero ops | No Machine management, no restart policies to configure |
| `flyctl redis` CLI | Create, connect, update, monitor — all built in |
| Private IPv6 within your Fly org | Same low latency, no public exposure |
| Upstash dashboard | Usage monitoring, connection strings, alerts |

For $10/month it's a no-brainer compared to managing your own Redis instance for a team of your size.

---

## Setup

```bash
# Create the database in London (same region as your API)
flyctl redis create
# → Choose org: surewaka
# → Choose primary region: lhr (London)
# → Plan: Fixed 250MB

# Get the connection URL
flyctl redis status <db-name>
# → Private URL: redis://password@fly-<name>.upstash.io

# Set it as a secret on your API and workers
flyctl secrets set REDIS_URL="redis://password@fly-<name>.upstash.io" --app surewaka-api
flyctl secrets set REDIS_URL="redis://password@fly-<name>.upstash.io" --app surewaka-workers
```

Your existing `ioredis` code works unchanged — just swap the `REDIS_URL`.

---

## When to upgrade

| Trigger | Action |
|---------|--------|
| Data exceeds 200MB | Upgrade to Fixed 1GB ($20/mo) |
| Need multi-region reads (Lagos + London) | Add read replica (+$5/region) |
| Bandwidth exceeds 50GB/month | Upgrade plan or add bandwidth |
| Need fine-grained eviction policies | Self-hosted gives more control |

## User

Match request atomicity — how to prevent double-assignment?

## Kiro


# Preventing Double-Assignment in Driver Matching

The core problem: two deliveries try to claim the same driver simultaneously, or two drivers race to accept the same delivery. Both are classic concurrency issues.

## Two Races to Solve

| Race | Scenario | Risk |
|------|----------|------|
| **Delivery → Driver** | Two deliveries see the same driver as "available" and both try to assign them | Driver gets double-booked |
| **Driver → Delivery** | Two drivers tap "Accept" on the same delivery at the same time | Delivery gets two drivers |

---

## Race 1: One Delivery, Multiple Drivers Accept

This is the simpler one. Use a Redis `SET NX` (set-if-not-exists) as an atomic lock:

```typescript
async function claimDelivery(driverId: string, deliveryId: string): Promise<boolean> {
  // Atomic: only one driver can win this
  const claimed = await redis.set(
    `delivery:claim:${deliveryId}`,
    driverId,
    'NX',   // only set if key doesn't exist
    'EX', 300 // auto-expire in 5 min (cleanup)
  );

  if (!claimed) {
    // Another driver already got it
    return false;
  }

  // Winner — proceed with assignment
  await db.update(deliveries)
    .set({ driverId, status: 'driver_assigned', updatedAt: new Date() })
    .where(and(eq(deliveries.id, deliveryId), isNull(deliveries.driverId)))
    .returning();

  return true;
}
```

**Why this works:** `SET NX` is atomic in Redis. No matter how many drivers hit it simultaneously, exactly one gets `OK`, all others get `null`.

---

## Race 2: Multiple Deliveries Claim Same Driver

This is harder. Two matching workers both see Driver A as "available" via `GEOSEARCH` and both try to assign them.

### Solution: Driver Availability Lock

```typescript
async function reserveDriver(driverId: string, deliveryId: string): Promise<boolean> {
  // Atomic: mark driver as reserved for this delivery
  const reserved = await redis.set(
    `driver:reserved:${driverId}`,
    deliveryId,
    'NX',
    'EX', 45 // 45s reservation window (time for driver to accept/decline)
  );

  if (!reserved) {
    // Driver already reserved for another delivery
    return false;
  }

  // Update driver metadata so GEOSEARCH filtering excludes them
  await redis.hset(`driver:meta:${driverId}`, { status: 'reserved' });

  return true;
}

async function releaseDriver(driverId: string): Promise<void> {
  await redis.del(`driver:reserved:${driverId}`);
  await redis.hset(`driver:meta:${driverId}`, { status: 'available' });
}
```

### Full atomic flow with Lua script

For true atomicity (check + set in one round-trip), use a Lua script:

```typescript
const RESERVE_DRIVER_SCRIPT = `
  local driverKey = KEYS[1]
  local metaKey = KEYS[2]
  local deliveryId = ARGV[1]
  local ttl = tonumber(ARGV[2])

  -- Check if driver is already reserved
  local existing = redis.call('GET', driverKey)
  if existing then
    return 0
  end

  -- Check if driver is still available
  local status = redis.call('HGET', metaKey, 'status')
  if status ~= 'available' then
    return 0
  end

  -- Atomic reserve
  redis.call('SET', driverKey, deliveryId, 'EX', ttl)
  redis.call('HSET', metaKey, 'status', 'reserved')
  return 1
`;

async function reserveDriverAtomic(driverId: string, deliveryId: string): Promise<boolean> {
  const result = await redis.eval(
    RESERVE_DRIVER_SCRIPT,
    2, // number of keys
    `driver:reserved:${driverId}`,   // KEYS[1]
    `driver:meta:${driverId}`,       // KEYS[2]
    deliveryId,                       // ARGV[1]
    '45'                              // ARGV[2] — TTL seconds
  );
  return result === 1;
}
```

**Why Lua:** Redis executes Lua scripts atomically — no other command can interleave between the `GET` check and the `SET`. This eliminates the check-then-act race condition.

---

## Complete Matching Flow with Atomicity

```
Matching Worker picks up job for Delivery X
        │
        ▼
GEOSEARCH → [Driver A, Driver B, Driver C, Driver D, Driver E]
        │
        ▼
Score & rank → [A=92, C=87, B=81, D=75, E=68]
        │
        ▼
For each driver (in score order):
        │
        ├── reserveDriverAtomic(A, deliveryX)
        │   ├── SUCCESS → send push to Driver A, add to offer list
        │   └── FAIL (reserved) → skip, try next
        │
        ├── reserveDriverAtomic(C, deliveryX)
        │   ├── SUCCESS → send push to Driver C, add to offer list
        │   └── FAIL → skip
        │
        └── ... until we have 5 reserved drivers (Tier 1)
        
        │
        ▼  (wait 30s for acceptance)
        │
        ├── Driver A taps Accept
        │   └── claimDelivery(A, deliveryX)
        │       ├── SUCCESS → assign, release other reservations, notify workflow
        │       └── FAIL (shouldn't happen if reservation held)
        │
        ├── Driver C taps Accept (too late)
        │   └── claimDelivery(C, deliveryX) → FAIL (A already claimed)
        │       └── Show "Job no longer available" in app
        │
        └── Timeout (no one accepts)
            └── releaseAll() → move to Tier 2
```

---

## State Machine: Driver Availability

```
                    ┌───────────┐
                    │ available │ ← visible in GEOSEARCH, can be reserved
                    └─────┬─────┘
                          │ reserveDriverAtomic()
                          ▼
                    ┌───────────┐
                    │ reserved  │ ← hidden from other matchers, 45s TTL
                    └─────┬─────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
         Accept      Decline     TTL expires
              │           │           │
              ▼           ▼           ▼
        ┌──────────┐ ┌───────────┐ ┌───────────┐
        │ assigned │ │ available │ │ available │
        │ (on job) │ │ (released)│ │ (auto)    │
        └──────────┘ └───────────┘ └───────────┘
```

---

## Defense in Depth: Postgres Constraint as Safety Net

Even with Redis locking, add a DB-level guard:

```typescript
// In the assignment step — belt AND suspenders
const [assigned] = await db.update(deliveries)
  .set({ driverId, status: 'driver_assigned', updatedAt: new Date() })
  .where(
    and(
      eq(deliveries.id, deliveryId),
      isNull(deliveries.driverId) // ← only assign if no driver yet
    )
  )
  .returning();

if (!assigned) {
  // Redis lock succeeded but DB says already assigned — race at DB level
  await releaseDriver(driverId);
  return { success: false, reason: 'already_assigned' };
}
```

And prevent a driver from holding two active deliveries:

```sql
-- Unique partial index: a driver can only have one active delivery
CREATE UNIQUE INDEX idx_one_active_delivery_per_driver
  ON deliveries (driver_id)
  WHERE status NOT IN ('delivered', 'cancelled', 'failed');
```

This makes the DB reject any double-assignment even if all Redis logic fails.

---

## Summary of Layers

| Layer | Mechanism | Protects against |
|-------|-----------|-----------------|
| **Redis Lua script** | Atomic check + reserve | Two matchers claiming same driver simultaneously |
| **Redis SET NX** | Atomic delivery claim | Two drivers accepting same delivery simultaneously |
| **Redis TTL** | Auto-expire reservations | Zombie reservations from crashed workers |
| **Postgres WHERE isNull(driverId)** | Conditional update | Any race that slips past Redis |
| **Postgres unique partial index** | DB constraint | Driver holding two active deliveries |

No single layer is sufficient alone. Redis handles the fast path (sub-ms). Postgres is the safety net that guarantees correctness even if Redis has a hiccup.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Worker crashes after reserving 3 drivers | TTL (45s) auto-releases. Drivers become available again. |
| Redis goes down mid-matching | Worker retries via BullMQ. Postgres constraint prevents corruption. |
| Driver's app sends Accept but network is slow | `SET NX` is idempotent — retrying the same accept is safe |
| Driver reserved but goes offline | 45s TTL expires → auto-released. Matching worker moves to next driver. |
| Two matching workers start for same delivery (BullMQ duplicate) | `delivery:claim` key ensures only one assignment sticks. Add BullMQ job deduplication by `deliveryId`. |

## User

will this work with fly upstash?

## Kiro

Yes, with one caveat.

## What works fine

| Feature | Upstash on Fly support |
|---------|----------------------|
| `GEOADD` / `GEOSEARCH` | ✅ |
| `SET NX EX` (atomic lock) | ✅ |
| `HSET` / `HGET` / `HGETALL` | ✅ |
| `ZREM` / `DEL` | ✅ |
| BullMQ queues | ✅ |
| TTL auto-expiry | ✅ |
| `ioredis` connection | ✅ (native TCP on fixed plans) |

## The caveat: Lua scripts

Upstash supports Lua scripts (`EVAL`) **but with restrictions**:

| Constraint | Impact on your code |
|------------|-------------------|
| All keys in a script must hash to the same slot | ⚠️ Problem if keys have different prefixes |
| Max script execution: 5s | ✅ Fine (yours runs in microseconds) |
| `redis.call` supported | ✅ |
| `EVALSHA` supported | ✅ |

The issue: your Lua script uses two keys with different prefixes:
```
KEYS[1] = driver:reserved:{driverId}
KEYS[2] = driver:meta:{driverId}
```

In Upstash (which uses Redis Cluster protocol internally), multi-key commands must operate on keys in the same **hash slot**. Keys hash to the same slot if the content inside `{}` is identical.

## Fix: Use hash tags

Force both keys into the same slot by using a common `{driverId}` hash tag:

```typescript
// Before (may fail on Upstash)
`driver:reserved:${driverId}`
`driver:meta:${driverId}`

// After (guaranteed same slot)
`driver:{${driverId}}:reserved`
`driver:{${driverId}}:meta`
```

Redis hashes only the content inside `{}` for slot assignment. Since both keys share `{driverId}`, they'll always land on the same slot.

Updated Lua script:

```typescript
const RESERVE_DRIVER_SCRIPT = `
  local reservedKey = KEYS[1]
  local metaKey = KEYS[2]
  local deliveryId = ARGV[1]
  local ttl = tonumber(ARGV[2])

  local existing = redis.call('GET', reservedKey)
  if existing then
    return 0
  end

  local status = redis.call('HGET', metaKey, 'status')
  if status ~= 'available' then
    return 0
  end

  redis.call('SET', reservedKey, deliveryId, 'EX', ttl)
  redis.call('HSET', metaKey, 'status', 'reserved')
  return 1
`;

async function reserveDriverAtomic(driverId: string, deliveryId: string): Promise<boolean> {
  const result = await redis.eval(
    RESERVE_DRIVER_SCRIPT,
    2,
    `driver:{${driverId}}:reserved`,   // KEYS[1] — same hash slot
    `driver:{${driverId}}:meta`,       // KEYS[2] — same hash slot
    deliveryId,
    '45'
  );
  return result === 1;
}
```

## Updated key naming convention

| Key pattern | Purpose |
|-------------|---------|
| `drivers:active` | Geo sorted set (single key, no slot issue) |
| `driver:{<id>}:meta` | Driver metadata hash |
| `driver:{<id>}:reserved` | Reservation lock |
| `delivery:{<id>}:claim` | Delivery acceptance lock |

The `delivery:claim` SET NX is a single-key operation — no slot issue there.

## Summary

Everything works on Fly Upstash Fixed plan. Just use `{id}` hash tags in key names so multi-key Lua scripts target the same slot. This is a one-line naming convention change, not an architectural change.