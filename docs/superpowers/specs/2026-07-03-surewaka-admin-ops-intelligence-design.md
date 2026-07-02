# SureWaka Admin — Ops Intelligence Platform Design

> **Authored:** 2026-07-03  
> **Audience:** Eteng (CEO/CTO), Yobo (COO), internal ops team  
> **Approach:** Hub-and-Spoke (Approach A)  
> **Scope:** Three subsystems delivered as three sequential specs

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

## Subsystem 1: Operations Hub (`/dashboard`)

### Purpose

The live nerve center. Replaces the current 4-stat-card dashboard with a real-time command center. Answers the question: *"What is happening right now and what needs my attention?"*

### Layout

Three zones rendered in a responsive grid:

```
┌─────────────────────────────────────────────────────────┐
│  LIVE KPI BAR  (5 cards, Supabase Realtime, 30s refresh) │
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

On screens < 1280px wide: Alert Feed collapses to a slide-over drawer triggered by a persistent badge in the header.

### Live KPI Cards

Five cards, each with a live count and a delta vs. yesterday's same time:

| Card | Metric | Red condition |
|---|---|---|
| Active Deliveries | In-progress right now | — |
| Drivers On Duty | Assigned + moving vs. available | — |
| At-Risk Deliveries | Overdue OR driver-silent | Any value > 0 |
| Open Disputes | Unresolved | Any value > 0 |
| On-Time Rate Today | % delivered on time so far today | < 80% |

**Status color rule:** Never convey status by color alone. Every warning state shows icon + color + text label (e.g., `⚠ 3 at risk` not just a red `3`).

### Live Delivery Map

- Reuses `delivery-map.tsx` and `use-delivery-realtime.ts` (already built for the deliveries page)
- Pin colors: `green` (on track), `amber` (running late), `red` (overdue or driver silent), `red + pulse animation` (driver silent >30 min)
- Driver location dots shown separately from delivery pins
- Click a pin → opens the existing `delivery-detail-view.tsx` panel on the right
- Realtime connection banner (`realtime-connection-banner.tsx`) shown if the socket drops

### At-Risk Delivery List

Not a full delivery table — only surfaces deliveries that need action:

**Columns:** Tracking ID · Customer · Driver · Status · Minutes Overdue · Risk Reason · Action

**Risk reasons (icon + text):**
- `⏱ Overdue` — past ETA
- `📡 Driver Silent` — no location update
- `⚠ No Update Sent` — customer hasn't received a status change in >90 min

**Row action:** One-click escalate button per row (opens escalation modal: call driver / reassign / mark failed). Bulk select + bulk escalate supported via checkbox column + floating action bar.

**Empty state:** When no deliveries are at risk — show a green confirmation state ("All deliveries on track") not a blank table.

### Alert Feed

Right panel (or slide-over on small screens). Chronological, most recent on top.

**Three severity levels:**

| Severity | Visual | Sound |
|---|---|---|
| Info | Grey dot | Silent |
| Warning | Amber dot + icon | Silent |
| Critical | Red dot + icon + bold text | — |

Each alert card shows:
- Severity indicator (icon + color + text — never color alone)
- What happened (e.g., "Driver silent 38 min")
- Which delivery + driver (with links)
- Timestamp (relative: "2 min ago")
- Quick action button (View, Call, Reassign)

Alerts auto-update via Supabase Realtime. Alerts auto-dismiss from the feed when their underlying condition resolves (e.g., driver location updates again).

---

## Subsystem 2: Analytics Suite (`/analytics`)

### Purpose

The weekly review screen. Answers: *"How did we perform, where did we slip, and which component caused it?"*

### Layout

Period selector (Today / This Week / This Month / Custom range) pinned at top. Six tabs below, each independently filterable.

### Tab 1 — Overview

KPI summary with sparklines (last 7 data points) showing trend direction. One card per metric:

| Metric | Definition | Target |
|---|---|---|
| On-Time Rate | % deliveries delivered by promised ETA | ≥ 90% |
| Fulfillment Rate | % accepted deliveries completed (not failed/cancelled) | ≥ 95% |
| Avg Delivery Time | Door-to-door in minutes, median | Baseline TBD |
| Dispute Rate | Disputes per 100 deliveries | < 2% |
| Customer Update Frequency | Avg status updates sent per delivery | ≥ 3 |
| Driver Completion Rate | % accepted jobs completed without abandonment | ≥ 97% |

Sparklines use Line Chart. Trend direction shown with `↑` (green) / `↓` (red) / `→` (neutral) — icon + color, never color alone.

### Tab 2 — Delivery Performance

- **Line Chart with Highlights**: On-time rate over time. Anomaly marker (circle + annotation) on days the rate drops >10 points. Red alert band drawn below the 80% threshold line.
- **Bar Chart (vertical)**: Delivery volume by outcome — completed (green), failed (red), disputed (amber), cancelled (grey). Sorted descending. Value labels on each bar.
- **Phase Breakdown (Horizontal Bullet Chart)**: Average minutes at each stage — Awaiting Pickup → Picked Up → In Transit → Delivered. This is the bottleneck detector. A phase that is consistently long is the operational problem to fix.
- **Late Delivery Distribution**: Horizontal bar chart showing how many minutes late, bucketed (0–15 min, 15–30 min, 30–60 min, >60 min).

### Tab 3 — Driver Performance

Sortable table with per-driver metrics:

| Column | Definition |
|---|---|
| Driver | Name + avatar |
| Deliveries | Total in period |
| On-Time % | Late deliveries vs. total |
| Completion % | Completed vs. accepted |
| Ghost Rate | Accepted then abandoned, % |
| Avg Rating | Customer rating |
| Reliability Score | Composite: completion 40% + on-time 35% + ghost 25% |

**Reliability Score** is the single number that tells operations who to trust for priority deliveries.

Trend chart below the table: Ghost rate and abandonment rate over time (line chart). A rising ghost rate signals a systemic problem — pay, demand, difficulty — not just individual driver behaviour.

### Tab 4 — Carrier Performance

For the aggregated carrier model (GIG, DHL, etc.):

- **Grouped Bar Chart**: SLA adherence per carrier (their promised pickup time vs. actual), side by side.
- **Fulfillment Rate per Carrier**: Horizontal bar, sorted descending — who actually delivers vs. who looks good in brochures.
- **Average Booking-to-Pickup Confirmation Time**: How long before a carrier acknowledges a booking.

### Tab 5 — Customer Experience

- **Update Frequency Trend (Line Chart)**: Average status updates per delivery over time. Target line at 3. If the line drops below 3, customers are going dark — this feeds directly into dispute rate.
- **Dispute Rate Trend**: Line chart. Correlates with update frequency — the relationship should be visible.
- **Resolution Time Distribution**: How many hours from dispute filed to resolved. Bullet chart vs. target (24hr target).
- **Repeat Booking Rate**: % of customers who booked again within 30 days. The most honest retention proxy.

### Tab 6 — Root Cause Analysis

The most operationally powerful tab. Turns aggregate data into actionable findings.

**Filter panel (left sidebar):**
- Time period (date range picker)
- Driver (multi-select)
- Lagos zone / area (Ikeja, Lekki, VI, Surulere, Mainland, Island, Other)
- Delivery type (On-demand vs. Carrier aggregation)
- Carrier (multi-select, only visible when carrier type selected)
- Time of day (Morning 6–10am / Midday 10am–3pm / Evening rush 3–7pm / Night 7pm–6am)

**Output (right):**

1. **Failure Decomposition (Donut/Pie with max 4 categories)**: Of all late or failed deliveries in the selected filters — what % were driver-caused, carrier-caused, route/traffic-caused, or system-caused (missed updates, booking errors). Always accompanied by a data table for accessibility.

2. **Top Contributors to Delay (Ranked List)**: The 5 biggest contributors to delay in the selected period, with specifics. Example entry:
   > `Driver Adewale A. — 14 late deliveries, avg 47 min late, all in Lekki, between 5–7pm`
   
   This is actionable. Not a trend — a named finding that leads to a corrective conversation.

3. **Correlation Surface**: A 2×2 heatmap — time of day (rows) × area (columns) — coloured by average delay minutes. Shows at a glance that "Lekki at 5pm is always red" without needing to build that intuition manually over weeks.

---

## Subsystem 3: Alert System

### Purpose

The system that finds the team when something needs attention. Three channels, one configuration point. Nothing critical is ever silent.

### Alert Rules (Default Thresholds)

| Rule | Warning | Critical |
|---|---|---|
| Driver Silent | No location update >15 min on active delivery | >30 min |
| Delivery Overdue | Past ETA by >30 min | >60 min |
| Driver Ghost | Accepted job, then went offline | Immediate |
| Dispute Filed | Any new dispute | — |
| Delivery Failed | Marked failed/undeliverable | — |
| On-Time Rate Drop | Today's rate < 80% | Today's rate < 60% |
| Customer Update Gap | No status update sent on active delivery >45 min | >90 min |

The Customer Update Gap rule is the most directly tied to the SureWaka promise — a customer who hasn't heard anything in 90 minutes does not feel "sure" about anything.

### Severity Routing

```
Info     → Alert feed (Ops Hub) only
Warning  → Alert feed + in-app notification bell (badge on sidebar icon)
Critical → Alert feed + in-app bell + Push notification (phone) + Slack/WhatsApp channel message
```

Rule: **Critical alerts are never silent.** If the ops screen is closed, the phone gets it. If Yobo's phone is off, the team channel gets it. The alert always has a receiver.

### Slack / WhatsApp Message Format

```
🔴 CRITICAL — Driver Silent
Delivery #SW-2847 | Driver: Chukwuemeka A.
No update for 38 minutes. Customer: Ngozi O. (Lekki Phase 1)
→ View delivery: https://admin.surewaka.ng/deliveries/SW-2847
```

Clean, human-readable, actionable. Only Critical severity hits the team channel — Warning and Info stay in-app to prevent channel fatigue.

### Alert Configuration (`/settings/alerts`)

- **Threshold editor**: One row per rule. Slider + number input for time-based thresholds (e.g., "Driver silent warning at X minutes"). Percentage input for rate-based rules.
- **Routing toggles per severity**: Toggle push and Slack/WhatsApp independently per severity level. Start conservative (Critical only for external channels), loosen as the team calibrates.
- **Slack webhook URL**: Input field + "Send test alert" button.
- **WhatsApp Business API config**: Webhook + phone number target.
- **Test alert button**: Sends a dummy Critical alert through all configured channels. Required before going live.
- **Alert history log**: Last 30 days of all fired alerts. Filterable by severity, rule type, and delivery. For auditing, not operational use.

### Technical Architecture

```
DB: alerts table (id, delivery_id, rule, severity, fired_at, resolved_at, ack_by)
Worker: /workers/alert-engine — 60s polling loop
  → reads active deliveries from DB
  → evaluates each rule against current state
  → writes new alert rows (idempotent — checks for existing unresolved alert per rule+delivery)
  → resolved_at auto-set when condition clears

Realtime: Supabase Realtime broadcasts INSERT on alerts table → admin dashboard
Push: existing push notification infrastructure in /workers/
Slack/WhatsApp: outbound HTTP webhook per alert row at Critical severity
```

No new npm dependencies. One new DB table. One new worker. Routing config stored in `settings` table.

---

## UI/UX Design Constraints

From the UI/UX Pro Max review:

- **Status colors**: Never color alone. Every warning/critical state: icon + color + text (e.g., `⚠ 3 at risk`, not a red `3`)
- **Loading states**: Skeleton/shimmer on every async panel. No frozen UIs.
- **Charts**: Line with Highlights (anomaly detection), Bullet Chart (KPI vs target), Horizontal Bar (driver comparison), Streaming Area (live delivery count). Library: Recharts (already likely in the stack) or ApexCharts.
- **Bulk actions**: Alert feed and at-risk list support checkbox multiselect + floating action bar (reassign, escalate, dismiss)
- **Accessibility**: `aria-label` on all icon-only buttons, `aria-live` on the alert feed, keyboard navigation through all panels
- **Dark mode**: The Ops Hub leans into the admin's existing dark mode as the preferred view — high contrast, data-dense, OLED-optimized. Analytics stays neutral (light default).
- **Responsive**: Alert feed collapses to slide-over drawer at < 1280px. KPI bar wraps to 2-column grid at < 768px.
- **Empty states**: Every list and chart has a meaningful empty state — never a blank panel.

---

## Prerequisites & Schema Gaps

Three gaps identified from the current schema that must be addressed before or during implementation:

### Gap 1 — No delivery event history (blocks Analytics Spec 2)

The `deliveries` table stores only the **current status**. `updated_at` reflects the last change, not a history. The Analytics Suite (phase breakdown, root cause drill-down) requires timestamped status transitions.

**Required migration:** `delivery_events` table

```sql
-- Tracks every status transition for a delivery
CREATE TABLE delivery_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  from_status delivery_status,
  to_status   delivery_status NOT NULL,
  triggered_by uuid REFERENCES users(id), -- driver, admin, or system
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_events_delivery_id ON delivery_events(delivery_id);
CREATE INDEX idx_delivery_events_created_at  ON delivery_events(created_at);
```

A DB trigger on `deliveries.status` auto-writes a row on every status change. This ensures retroactive capture from the moment the migration lands without any app-layer changes.

**The delivery statuses already defined cover every phase needed:**
`draft → pending → accepted → en_route_pickup → arrived_pickup → picked_up → en_route_dropoff → arrived_dropoff → delivered / cancelled / failed / returned`

This migration is the prerequisite for Spec 2. Spec 1 (Ops Hub) does not depend on it.

### Gap 2 — No ETA field (blocks Overdue alert rule)

The deliveries table has no `estimated_delivery_at` column. The alert rule "delivery overdue by >30 min" requires an ETA to compare against.

**Required migration:** Add `estimated_delivery_at timestamptz` to `deliveries`. This should be set at booking time (customer-promised time) and optionally updated by the driver or carrier. The Ops Hub and Alert Engine both read this field.

### Gap 3 — No charting library in admin

The admin has no chart library. The Analytics Suite requires one.

**Recommended:** `recharts` — React-native, composable, works with Tailwind/shadcn, zero fighting with the existing stack. Add to `apps/admin` only. No other app needs it.

```bash
pnpm --filter @surewaka/admin add recharts
```

Chart components live in `apps/admin/app/components/analytics/`. Not in `packages/ui` — these are admin-only.

---

## Implementation Sequence

Three specs, in order:

| # | Spec Name | Dependency | Key deliverables |
|---|---|---|---|
| 1 | `admin-ops-hub` | Delivery realtime already half-built | Enhanced `/dashboard`, live KPIs, alert feed UI, at-risk list |
| 2 | `admin-analytics-suite` | Needs status-change event timestamps in DB | Six-tab `/analytics` with charts and root cause drill-down |
| 3 | `admin-alert-system` | Ops Hub alert feed UI must exist | Alert worker, alert DB table, push routing, Slack/WhatsApp webhooks, `/settings/alerts` config |

Spec 1 can be started immediately — it builds on existing realtime infrastructure. Spec 2 requires confirming delivery event history is captured at the right granularity (each status change timestamped). Spec 3 requires Spec 1's alert feed component to exist as the in-app surface.

---

## What This Proves

When this system is live, every stakeholder can answer three questions from the dashboard in under 10 seconds:

1. **Is everything okay right now?** → Ops Hub KPI bar + map
2. **Did we perform well this week?** → Analytics Overview tab
3. **What caused the failures?** → Root Cause Analysis tab

That is what "SureWaka" means in practice.
