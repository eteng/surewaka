# SureWaka Admin — Ops Intelligence Platform Design

> **Authored:** 2026-07-03  
> **Audience:** Eteng (CEO/CTO), Yobo (COO), internal ops team  
> **Approach:** Hub-and-Spoke (Approach A)  
> **Scope:** Four sequential specs — Spec 0 is a delivery model prerequisite for all others

---

## Vision

The SureWaka admin must be a live proof of its own name. "Surewaka" means *sure process* — the dashboard should make that provable at a glance: customers always know where their goods are, delays are detected instantly, and the root cause of every failure is identifiable by data, not gut feel.

The platform is built around three systems:

| Subsystem | Route | Purpose | Cadence |
|---|---|---|---|
| Operations Hub | `/dashboard` | What is happening right now | Open all day |
| Analytics Suite | `/analytics` | How did we perform and what caused failures | Weekly review |
| Alert System | Global + `/settings/alerts` | Finds you when something needs attention | Interrupt-driven |

---

## Delivery Model (Spec 0 — prerequisite for everything)

### Why this comes first

SureWaka supports three delivery patterns:

1. **Intra-city on-demand** — rider picks up from sender, drops at recipient. Single leg.
2. **Intercity — home pickup** — Leg 1: rider to hub/park → Leg 2: partner carrier to destination city → Leg 3: last-mile dispatcher to recipient.
3. **Intercity — self-drop** — customer drops at hub. Legs 2 and 3 only.

The current `deliveries` schema is strictly point-to-point (one `driver_id`, one `carrier_id`, one pickup, one dropoff). It cannot represent multi-leg, multi-actor deliveries. Building analytics on a single-leg model when the product is multi-leg produces incorrect data. Spec 0 fixes the foundation before anything else is built on top of it.

### New tables required

**`delivery_legs`** — one row per leg per delivery:

```sql
CREATE TABLE delivery_legs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_number      smallint NOT NULL,        -- 1, 2, 3
  leg_type        text NOT NULL,            -- 'first_mile' | 'intercity' | 'last_mile'
  actor_type      text NOT NULL,            -- 'driver' | 'carrier'
  actor_id        uuid NOT NULL,            -- references drivers.id or carriers.id
  pickup_address  text NOT NULL,
  pickup_lat      real NOT NULL,
  pickup_lng      real NOT NULL,
  pickup_zone     text,                     -- Lagos zone, set at creation via LocationIQ
  dropoff_address text NOT NULL,
  dropoff_lat     real NOT NULL,
  dropoff_lng     real NOT NULL,
  dropoff_zone    text,
  status          delivery_status NOT NULL DEFAULT 'pending',
  system_eta_at   timestamptz,             -- calculated at booking
  driver_eta_at   timestamptz,             -- updated by driver after acceptance
  sla_hours       real,                     -- from carrier_sla_overrides or leg_type default
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**`delivery_events`** — audit trail and customer update source:

```sql
CREATE TABLE delivery_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_id       uuid REFERENCES delivery_legs(id),
  from_status  delivery_status,
  to_status    delivery_status NOT NULL,
  triggered_by uuid REFERENCES users(id),  -- driver, admin, system (null = system)
  failure_cause text,                       -- 'driver' | 'carrier' | 'route_traffic' | 'system'
  failure_note  text,                       -- ops override note
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_events_delivery_id ON delivery_events(delivery_id);
CREATE INDEX idx_delivery_events_leg_id      ON delivery_events(leg_id);
CREATE INDEX idx_delivery_events_created_at  ON delivery_events(created_at);
```

A DB trigger on `delivery_legs.status` auto-writes a row on every status change. `failure_cause` is set by the alert engine (inference) and overridable by ops. Customer-facing status notifications are triggered by events where `to_status IN ('accepted', 'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered')`.

**`driver_locations`** — GPS ping history (replaces point-in-time `lat`/`lng` on drivers):

```sql
CREATE TABLE driver_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES deliveries(id),
  lat         real NOT NULL,
  lng         real NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_locations_driver_recorded ON driver_locations(driver_id, recorded_at DESC);
```

Location history enables driver silence detection (`MAX(recorded_at) per active driver`), dispute investigation (route replay), and future heatmaps. The mobile app writes here on every GPS ping.

**`delivery_ratings`** — per-delivery customer ratings:

```sql
CREATE TABLE delivery_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES drivers(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

The aggregate `rating` on `drivers` is maintained via trigger. Per-period average ratings and trend charts read from this table.

**`carrier_sla_overrides`** — route-specific SLA commitments per carrier:

```sql
CREATE TABLE carrier_sla_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id       uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  origin_zone      text NOT NULL,
  destination_zone text NOT NULL,
  sla_hours        real NOT NULL,
  UNIQUE (carrier_id, origin_zone, destination_zone)
);
```

Default SLAs by leg type (used when no carrier override exists):
- `first_mile`: 1 hour
- `intercity`: 24 hours  
- `last_mile`: 2 hours

### Migrations to `deliveries` table

- Add `system_eta_at timestamptz` — ETA calculated by platform at booking based on distance + time of day + vehicle type
- Add `driver_eta_at timestamptz` — updated by driver after acceptance; takes precedence over `system_eta_at` for alert evaluation
- `driver_id` and `carrier_id` on `deliveries` become nullable denormalised convenience fields pointing to the primary leg actor; legs are the authoritative source

### Zone classification

When a leg is created, the API calls LocationIQ (already a dependency in `packages/mobile-shared`) server-side to reverse-geocode `pickup_lat/lng` and `dropoff_lat/lng` into a Lagos area name, then maps it to a canonical zone:

```
Lekki | Victoria Island | Ikeja | Surulere | Mainland | Island | Other
```

Stored on `delivery_legs.pickup_zone` and `delivery_legs.dropoff_zone`. No runtime geo work in analytics queries.

---

## Subsystem 1: Operations Hub (`/dashboard`)

### Purpose

The live nerve center. Replaces the current 4-stat-card dashboard. Answers: *"What is happening right now and what needs my attention?"*

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  LIVE KPI BAR  (5 cards, Ably, 30s refresh) │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│   LIVE DELIVERY MAP          │   ALERT FEED             │
│   (driver pins, color-coded) │   (severity-ranked,      │
│   click pin → detail panel   │   auto-updates via RT)   │
│                              │                          │
├──────────────────────────────┤                          │
│   AT-RISK DELIVERY LIST      │                          │
│   (overdue + driver-silent   │                          │
│   only — not all deliveries) │                          │
└──────────────────────────────┴──────────────────────────┘
```

On screens < 1280px: Alert Feed collapses to a slide-over drawer triggered by a persistent badge in the header.

### Live KPI Cards

| Card | Metric | Red condition |
|---|---|---|
| Active Deliveries | In-progress legs right now | — |
| Drivers On Duty | Assigned + moving vs. available | — |
| At-Risk Deliveries | Overdue OR driver-silent | Any value > 0 |
| Open Disputes | Unresolved | Any value > 0 |
| On-Time Rate Today | % deliveries delivered by overall ETA so far today | < 80% |

**Status color rule:** Never convey status by color alone. Every warning state shows icon + color + text (e.g., `⚠ 3 at risk`, not a red `3`).

### Live Delivery Map

- Reuses `delivery-map.tsx` and `use-delivery-realtime.ts` (already built for the deliveries page)
- Pins represent active legs, color-coded:
  - Green: on track vs. `driver_eta_at` or `system_eta_at`
  - Amber: running late
  - Red: overdue or driver silent
  - Red + pulse: driver silent >30 min
- Driver location dots from `driver_locations` (most recent ping per driver)
- Click pin → opens `delivery-detail-view.tsx` panel
- Realtime connection banner shown if socket drops

### At-Risk Delivery List

Not a full delivery table — only surfaces legs/deliveries that need action.

**Columns:** Tracking ID · Customer · Actor (driver or carrier) · Leg · Status · Time Overdue · Risk Reason · Action

**Risk reasons (icon + text):**
- `⏱ Overdue` — past `driver_eta_at` (or `system_eta_at` if not set)
- `📡 Driver Silent` — `MAX(recorded_at)` on `driver_locations` >15 min ago on active leg
- `⚠ No Update Sent` — no customer-facing `delivery_event` in >90 min on active delivery

**Note on hub-waiting alerts:** During intercity legs where a parcel is waiting at a hub for carrier pickup, the "No Update Sent" alert will fire after 90 minutes. Ops dismisses these — they represent a known gap in automated customer communication during hub dwell time. This is a monitored limitation, with a proactive messaging feature as a clear upgrade path once the alert volume is understood.

**Row action:** One-click escalate button (call actor / reassign / mark failed). Bulk select + floating action bar for bulk escalation.

**Empty state:** Green confirmation state ("All deliveries on track") — never a blank table.

### Alert Feed

Right panel. Chronological, most recent on top. Updates via Ably on `alerts` table inserts.

| Severity | Visual | Routing |
|---|---|---|
| Info | Grey dot | Feed only |
| Warning | Amber dot + icon | Feed + in-app bell |
| Critical | Red dot + icon + bold | Feed + bell + push + Pumble |

Each alert card: severity indicator · what happened · delivery + actor links · relative timestamp · quick action button.

Alert escalation: when a Warning escalates to Critical, the existing alert row is updated (`severity = 'critical'`, `escalated_at = now()`, `original_severity = 'warning'`). One row per active condition — no duplicate cards in the feed.

Alerts auto-dismiss when the underlying condition resolves (e.g., driver location updates, delivery marked delivered).

---

## Subsystem 2: Analytics Suite (`/analytics`)

### Purpose

The weekly review screen. Answers: *"How did we perform, where did we slip, and which component caused it?"*

### Layout

Period selector (Today / This Week / This Month / Custom range) pinned at top. Six tabs below.

### Tab 1 — Overview

KPI cards with sparklines (last 7 data points). Trend shown with ↑ / ↓ / → icon + color:

| Metric | Definition | Target |
|---|---|---|
| On-Time Rate | % deliveries delivered by overall ETA (delivery-level) | ≥ 90% |
| Fulfillment Rate | % accepted deliveries completed (not failed/cancelled) | ≥ 95% |
| Avg Delivery Time | Door-to-door minutes, median across all legs | Baseline TBD post-launch |
| Dispute Rate | Disputes per 100 deliveries | < 2% |
| Customer Update Frequency | Avg customer-facing events per delivery | ≥ 3 |
| Driver Completion Rate | % accepted legs completed without ghost/abandonment | ≥ 97% |

### Tab 2 — Delivery Performance

- **Line Chart with Highlights**: On-time rate (delivery-level) over time. Anomaly marker when rate drops >10 points day-over-day. Red band below 80% threshold.
- **Bar Chart**: Delivery volume by outcome — completed, failed, disputed, cancelled. Value labels on each bar.
- **Phase Breakdown (Bullet Chart)**: Average minutes per leg type — first_mile, intercity, last_mile — vs. default SLA. This is the bottleneck detector. A leg type consistently above SLA is the operational problem to fix.
- **Late Delivery Distribution**: How many minutes late, bucketed (0–15, 15–30, 30–60, >60).

### Tab 3 — Driver Performance

Sortable table, per driver, per selected period:

| Column | Definition |
|---|---|
| Driver | Name + avatar |
| Legs | Total legs accepted in period |
| On-Time % | Legs completed within `driver_eta_at` or `system_eta_at` |
| Completion % | Completed legs vs. accepted |
| Ghost Rate | Legs where `triggered_by = driver_id` cancelled before `picked_up`, OR location silence + system auto-cancel |
| Avg Rating | Average from `delivery_ratings` in period |
| Reliability Score | Composite: completion 40% + on-time 35% + ghost 25% (inverted) |

**Ghost rate precision:** Excludes customer-triggered cancellations (`triggered_by = customer_id`) and pure system timeouts (`triggered_by IS NULL AND driver had GPS pings`). Only counts driver-initiated abandonment or location-silence + system auto-cancel.

Trend chart below: ghost rate and abandonment trend over time. A rising ghost rate signals a systemic issue (pay, demand, difficulty) not individual behaviour.

**Nigerian network note:** The driver silent threshold (15 min) accounts for Lagos network conditions — intermittent 3G in traffic or under-coverage areas. The threshold is configurable in `/settings/alerts` and should not be read as driver negligence below 30 minutes without corroborating signals.

### Tab 4 — Carrier Performance (Leg-Level SLA)

SLA adherence is measured at leg level — this is the optimization layer.

- **SLA Adherence per Carrier (Grouped Bar)**: For each carrier, actual intercity leg duration vs. their `carrier_sla_overrides` entry for that route (or default 24h if no override). Side-by-side comparison.
- **Fulfillment Rate per Carrier**: % intercity legs completed without failure. Sorted descending.
- **Avg Leg Duration by Route**: Carrier × origin_zone × destination_zone heat table. Shows which specific routes are underperforming, not just which carrier overall.
- **SLA Override Coverage**: How many carrier-route combinations have a configured `carrier_sla_overrides` entry vs. falling back to defaults. A prompt to ops to fill gaps as carrier agreements are signed.

Carriers consistently missing SLA on specific routes are the optimization targets — renegotiate, re-route, or replace.

### Tab 5 — Customer Experience

- **Update Frequency Trend**: Avg customer-facing `delivery_events` per delivery over time. Target line at 3. Source: events where `to_status IN ('accepted', 'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered')`.
- **Dispute Rate Trend**: Line chart. Should correlate inversely with update frequency — the relationship is the insight.
- **Resolution Time Distribution**: Hours from dispute filed to resolved. Bullet chart vs. 24h target.
- **Repeat Booking Rate**: Two windows shown side by side:
  - 30-day: captures frequent shippers (weekly e-commerce sellers)
  - 60-day: captures monthly-cycle SMEs (pay-day shippers)
  
  The gap between the two numbers is itself a signal: a large gap means customers on a longer cycle are being misread as churned. Prevents premature re-engagement campaigns targeting customers who were coming back anyway.

### Tab 6 — Root Cause Analysis

The most operationally powerful tab. Turns data into corrective action.

**Filter panel:**
- Time period (date range picker)
- Driver (multi-select)
- Carrier (multi-select)
- Lagos zone — pickup or dropoff (Lekki / VI / Ikeja / Surulere / Mainland / Island / Other)
- Leg type (first_mile / intercity / last_mile)
- Time of day (Morning 6–10am / Midday 10am–3pm / Evening rush 3–7pm / Night 7pm–6am)

**Output:**

1. **Failure Decomposition (Donut, max 4 categories)**: Of all late/failed legs in the selected filter — what % were `driver`, `carrier`, `route_traffic`, or `system` caused. Source: `delivery_events.failure_cause`. Auto-inferred by the alert engine; overridable by ops. Always accompanied by a data table for accessibility.

2. **Top Contributors to Delay (Ranked List)**: 5 biggest contributors in the selected period with specifics. Example: `Driver Adewale A. — 14 late legs, avg 47 min late, all Lekki dropoffs, 5–7pm`. Named and actionable.

3. **Correlation Surface (Heatmap)**: Time of day (rows) × Lagos zone (columns) → average delay minutes. Shows at a glance that "Lekki at 5pm is always red" without building that intuition manually over weeks. Zone data read from `delivery_legs.dropoff_zone`.

---

## Subsystem 3: Alert System

### Purpose

The system that finds the team when something needs attention. Three channels, one configuration point. Nothing critical is ever silent.

### Alert Rules

| Rule | Warning trigger | Critical trigger |
|---|---|---|
| Driver Silent | No `driver_locations` ping >15 min on active leg | >30 min |
| Leg Overdue | Past `driver_eta_at` (or `system_eta_at`) by >30 min | >60 min |
| Driver Ghost | Leg accepted, actor went offline (see ghost definition) | Immediate |
| Dispute Filed | Any new dispute | — |
| Delivery Failed | Marked failed/undeliverable | — |
| On-Time Rate Drop | Today's delivery-level rate < 80% | < 60% |
| Customer Update Gap | No customer-facing event on active delivery >45 min | >90 min |

**Driver Silent threshold rationale:** 15 minutes accounts for Nigerian network conditions — spotty 3G coverage, Third Mainland Bridge dead zones, tunnel or basement connectivity loss. A driver going silent for 14 minutes in Lagos traffic is likely a network drop, not a ghost. The threshold is configurable.

**Ghost detection:** `triggered_by = driver_id` on a cancellation event before `picked_up` status, OR `triggered_by IS NULL` (system timeout) AND no `driver_locations` ping in the last 30 minutes on that leg. Excludes customer-triggered cancellations.

**Alert escalation:** When a Warning escalates to Critical, the existing alert row is updated in place: `severity = 'critical'`, `escalated_at = now()`, `original_severity = 'warning'` stored. One row per active condition per rule per leg. No duplicate alert cards.

### Severity Routing

```
Info     → Alert feed (Ops Hub) only
Warning  → Alert feed + in-app notification bell
Critical → Alert feed + bell + push notification (phone) + Pumble channel message
```

Critical alerts are never silent. WhatsApp Business API is the upgrade path once a BSP account is provisioned — the routing config and message format are identical; only the delivery channel changes.

### Pumble Message Format

```
🔴 CRITICAL — Driver Silent
Delivery #SW-2847 | Leg 1 (First Mile) | Driver: Chukwuemeka A.
No GPS ping for 38 minutes. Customer: Ngozi O. (Lekki Phase 1)
→ View delivery: https://admin.surewaka.ng/deliveries/SW-2847
```

Only Critical severity hits the Pumble channel — Warning and Info stay in-app to prevent channel fatigue.

### Push Notifications

Built as part of Spec 3 — there is no existing push infrastructure. Spec 3 owns:
- FCM/Expo push token storage (indexed per admin user)
- `send-push` worker
- Routing critical alert events through the worker

### Alert Configuration (`/settings/alerts`)

- **Threshold editor**: One row per rule. Slider + number input for time-based rules. Percentage input for rate rules.
- **Routing toggles**: Push and Pumble independently togglable per severity. Default: Critical only for external channels.
- **Pumble webhook URL**: Input + "Send test alert" button.
- **WhatsApp config**: Placeholder UI — "WhatsApp Business (coming soon)" — for when BSP account is ready.
- **Test alert button**: Sends a dummy Critical through all configured channels. Required before going live.
- **Alert history log**: Last 30 days, filterable by severity, rule, delivery, leg.

### Technical Architecture

```
DB: alerts table
  (id, delivery_id, leg_id, rule, severity, original_severity,
   fired_at, escalated_at, resolved_at, ack_by)

Worker: workers/alert-engine — 60s polling loop
  → reads active legs from DB
  → evaluates each rule
  → writes new alert rows (idempotent: one unresolved row per rule+leg)
  → escalates in place when threshold crosses from warning → critical
  → sets resolved_at when condition clears

Realtime: Ably broadcasts alerts table changes → Ops Hub feed
Push: send-push worker (built in Spec 3)
Pumble: outbound HTTP POST to webhook per Critical alert row
```

**Polling interval:** 60 seconds. Acceptable precision for a 15-minute silence threshold (≈7% window uncertainty). Nigerian network conditions mean a hair-trigger detection below 60s produces false positives. Low DB load, simple worker.

Config stored in `settings` table (existing pattern). No new npm dependencies beyond the push SDK added in Spec 3.

---

## UI/UX Design Constraints

- **Status colors**: Never color alone — icon + color + text on every warning/critical state
- **Loading states**: Skeleton/shimmer on every async panel — no frozen UIs
- **Charts**: `recharts` (add to `apps/admin` only). Line with Highlights for anomaly detection, Bullet Chart for SLA vs. actual, Horizontal Bar for driver/carrier comparison, Heatmap for correlation surface
- **Bulk actions**: At-risk list and alert feed support checkbox multiselect + floating action bar
- **Accessibility**: `aria-label` on icon-only buttons, `aria-live` on alert feed, keyboard navigation throughout
- **Dark mode**: Ops Hub leans into existing dark mode — high contrast, data-dense. Analytics neutral (light default)
- **Responsive**: Alert feed collapses to slide-over at <1280px. KPI bar wraps to 2-column at <768px
- **Empty states**: Every list and chart has a meaningful empty state — never a blank panel

---

## Implementation Sequence

Four specs, in strict order:

| # | Spec name | Key deliverables | Dependency |
|---|---|---|---|
| 0 | `admin-delivery-model` | `delivery_legs`, `delivery_events`, `driver_locations`, `delivery_ratings`, `carrier_sla_overrides`, ETA fields, zone classification | None — must ship first |
| 1 | `admin-ops-hub` | Enhanced `/dashboard`, live KPIs, map, at-risk list, alert feed UI | Spec 0 |
| 2 | `admin-analytics-suite` | Six-tab `/analytics`, all charts, root cause drill-down | Spec 0 |
| 3 | `admin-alert-system` | Alert engine worker, push infrastructure, Pumble webhook, `/settings/alerts` | Spec 1 (alert feed UI) |

Specs 1 and 2 can be built in parallel once Spec 0 is complete. Spec 3 requires Spec 1's alert feed component to exist as the in-app surface.

---

## What This Proves

When this system is live, every stakeholder answers three questions in under 10 seconds:

1. **Is everything okay right now?** → Ops Hub KPI bar + map
2. **Did we perform well this week?** → Analytics Overview tab
3. **What caused the failures, and who or what do we need to fix?** → Root Cause Analysis tab

That is what "SureWaka" means in practice.
