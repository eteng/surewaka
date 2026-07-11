# Dynamic Zones — Design Revisions TODO

Consolidated design changes from grilling session (2026-07-07). These supersede the original `design.md` and `requirements.md` where they conflict.

---

## Breaking Changes to Original Design

### 1. Clean break — no dual-column coexistence

- **Drop** `pickup_zone` and `dropoff_zone` text columns from `delivery_legs`
- **Drop** `origin_zone` and `destination_zone` text columns from `carrier_sla_overrides`
- **Replace** with UUID FK columns only (`pickup_zone_id`, `dropoff_zone_id`, `origin_zone_id`, `destination_zone_id`)
- **Delete** all backfill scripts (no longer needed)
- **Delete** deprecation phases 1/2/3 — single atomic migration
- **Re-seed** all delivery/SLA data instead of backfilling
- Remove `@deprecated` annotations on `LAGOS_ZONES` / `LagosZone` — just delete them outright

### 2. Remove "Other" zone from seed data

- The classifier returns `null` for unclassifiable coordinates
- No "Other" zone row in the DB
- UI renders null zones as "Unclassified" or "—" for display

### 3. SLA override validator accepts zone UUIDs (not text names)

- `createCarrierSlaOverrideSchema`: replace `z.enum([...])` with `z.string().uuid()` for `originZoneId` and `destinationZoneId`
- Admin UI presents a zone picker dropdown (fetched from zones endpoint), submits UUIDs

### 4. FK constraints tightened

| Table | Columns | Nullable | On Delete |
|-------|---------|----------|-----------|
| `delivery_legs` | `pickup_zone_id`, `dropoff_zone_id` | YES | RESTRICT |
| `carrier_sla_overrides` | `origin_zone_id`, `destination_zone_id` | NO (NOT NULL) | RESTRICT |

- RESTRICT prevents hard-deleting zones with historical references
- Soft-delete (`is_active = false`) is the standard deactivation path

---

## Classifier Redesign

### 5. New signature

```typescript
classifyZone(
  addressText: string,
  lat: number,
  lng: number,
  opts?: { skipRemote?: boolean }
): Promise<{ id: string; name: string } | null>
```

### 6. Two-phase classification

1. **Local match** — keyword match against `addressText`, filtered by bounding box using lat/lng
2. **Remote fallback** — if no local match and `skipRemote !== true`, call LocationIQ reverse-geocode, then keyword match against the returned address
3. Return `null` if both phases fail

### 7. Address text source

- Use joined `address` object fields from LocationIQ (not `display_name`)
- Primary input is the address text already on the delivery leg record (`pickup_address`, `dropoff_address`)
- LocationIQ is a fallback, not the primary path — saves API quota

### 8. Keyword uniqueness — application-layer enforcement

- On zone create/update: query all active zones in same `(city, country)`, collect keywords, reject if overlap
- Error message: "Keyword 'lekki' is already assigned to zone 'Lekki' in Lagos, Nigeria"
- No DB-level keyword constraint (text[] column stays, no junction table)

---

## API Changes

### 9. Zone listing requires authentication

- `GET /api/v1/zones` — requires `requireAuth` (any authenticated user), no role check
- Returns active zones only
- Prevents unauthenticated enumeration of coverage areas

### 10. Zone creation requires at least one keyword

- Validator enforces `keywords.min(1)` — a zone without keywords is inert (can never be classified to)
- Bounding box remains optional

---

## Admin UI Changes

### 11. New "Coverage" nav section

- New nav group: "Coverage"
- Route: `/coverage/zones`
- Future siblings: `/coverage/service-areas`, `/coverage/pricing-regions`

### 12. Analytics heatmap scoped to single metro

- Replace zone filter dropdown with metro/city picker (defaults to "Lagos")
- Heatmap renders columns for active zones within the selected metro only
- API response includes zone list dynamically (no hardcoded `LAGOS_ZONES`)

---

## Seed Data

### 13. Full Nigeria seed — hybrid approach

| Tier | Metros | Zones per metro | Detail level |
|------|--------|-----------------|--------------|
| Tier 1 | Lagos | 6 zones | Full neighbourhood breakdown with bounding boxes + keywords |
| Tier 2 | Abuja, Port Harcourt, Ibadan, Kano | 4–6 zones each | Key areas with keywords |
| Tier 3 | All other state capitals (~30) | 1 zone each | City name + common area names as keywords |

- Total: ~55–70 zone rows
- No "Other" zone in any metro

---

## Scope Clarification

### 14. This spec = zone infrastructure only

Included:
- `zones` table + schema
- Zone CRUD API
- Classifier rewrite (new signature, two-phase, cache)
- Alert engine SQL migration (direct JOIN on zone_id, zone is omitted from context when null)
- Analytics SQL migration (JOIN on zone_id, metro-scoped heatmap)
- Admin UI (`/coverage/zones`)
- Seed script for all Nigeria zones
- Delete `LAGOS_ZONES`, `LagosZone`, and all references

NOT included (separate spec):
- Delivery leg creation service (where classifier gets called)
- "% unclassified legs" analytics metric

### 15. Classifier integration contract for future leg-creation spec

```typescript
import { classifyZone } from '../lib/zone-classifier';

// On leg INSERT:
const pickupResult = await classifyZone(pickupAddress, pickupLat, pickupLng);
const dropoffResult = await classifyZone(dropoffAddress, dropoffLat, dropoffLng);

// Write to leg:
// pickup_zone_id = pickupResult?.id ?? null
// dropoff_zone_id = dropoffResult?.id ?? null
```

---

## Requirements to Delete/Revise

These requirement sections are obsolete given the clean break:

- **Req 4.2, 4.3, 4.5, 4.6, 4.7** — dual-write, backfill scripts (eliminated)
- **Req 5.2, 5.3, 5.4, 5.6, 5.7, 5.8** — SLA text column coexistence, backfill (eliminated)
- **Req 6.6** — `createCarrierSlaOverrideSchema` uses UUID now, not `z.string().min(1).max(100)`
- **Req 10 (entire section)** — backward compatibility is no longer a concern (clean break)
- **Req 7.3** — alert engine omits `zone` key when null (not "Unknown", confirmed)
- **Req 9.3** — require at least one keyword (confirmed, no change needed)
- **Req 8.2** — add metro scoping to heatmap
