import { sql } from 'drizzle-orm';
import { db } from '@surewaka/db';
import { CUSTOMER_FACING_STATUSES } from '@surewaka/shared';

// ─── Period helper ────────────────────────────────────────────────────────────

export function periodToDates(
  period: string,
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  if (period === 'today') {
    return { start: startOfToday, end: now };
  }
  if (period === 'month') {
    const start = new Date(startOfToday);
    start.setUTCDate(start.getUTCDate() - 30);
    return { start, end: now };
  }
  if (period === 'custom' && from && to) {
    const start = new Date(from);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    return { start, end };
  }
  // Default: week
  const start = new Date(startOfToday);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end: now };
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type SparkPoint = { date: string; value: number };

export type OverviewKpis = {
  onTimeRate: number;
  onTimeRateSparkline: SparkPoint[];
  fulfillmentRate: number;
  fulfillmentRateSparkline: SparkPoint[];
  avgDeliveryMinutes: number;
  avgDeliveryMinutesSparkline: SparkPoint[];
  disputeRate: number;
  disputeRateSparkline: SparkPoint[];
  customerUpdateFrequency: number;
  customerUpdateFrequencySparkline: SparkPoint[];
  driverCompletionRate: number;
  driverCompletionRateSparkline: SparkPoint[];
};

export type DailyOnTimePoint = { date: string; rate: number; isAnomaly: boolean };
export type OutcomeBar = { status: string; count: number };
export type PhaseBar = { legType: string; avgMinutes: number; slaHours: number };
export type LateDistBar = { bucket: string; count: number };

export type DeliveryPerformanceData = {
  dailyOnTimeRate: DailyOnTimePoint[];
  volumeByOutcome: OutcomeBar[];
  phaseBreakdown: PhaseBar[];
  lateDistribution: LateDistBar[];
};

export type DriverPerformanceRow = {
  driverId: string;
  name: string;
  totalLegs: number;
  onTimePct: number;
  completionPct: number;
  ghostRate: number;
  avgRating: number;
  reliabilityScore: number;
};

export type CarrierSlaRow = {
  carrierId: string;
  name: string;
  avgActualHours: number;
  slaHours: number;
  adherencePct: number;
  fulfillmentPct: number;
};

export type CarrierPerformanceData = {
  rows: CarrierSlaRow[];
  overrideCoverage: { configured: number; total: number };
};

export type CustomerExperienceData = {
  updateFrequencyTrend: SparkPoint[];
  avgUpdateFrequency: number;
  disputeRateTrend: SparkPoint[];
  avgDisputeRate: number;
  avgResolutionHours: number;
  repeatRate30d: number;
  repeatRate60d: number;
};

export type RootCauseParams = {
  start: Date;
  end: Date;
  zone?: string;
  driverId?: string;
  carrierId?: string;
  legType?: string;
  timeOfDay?: 'morning' | 'midday' | 'evening' | 'night';
};

export type FailureShare = { cause: string; count: number; pct: number };
export type TopContributor = {
  actorType: 'driver' | 'carrier';
  actorId: string;
  name: string;
  lateCount: number;
  avgMinutesLate: number;
  topZone: string;
  topTimeOfDay: string;
};
export type HeatCell = { zone: string; timeOfDay: string; avgDelayMinutes: number };

export type RootCauseData = {
  failureDecomposition: FailureShare[];
  topContributors: TopContributor[];
  heatmap: HeatCell[];
};

// ─── Time-of-day helper ───────────────────────────────────────────────────────

function timeOfDayFilter(col: string, slot: string): string {
  const ranges: Record<string, [number, number]> = {
    morning: [6, 10],
    midday: [10, 15],
    evening: [15, 19],
    night: [19, 6],
  };
  const r = ranges[slot];
  if (!r) return 'TRUE';
  if (slot === 'night') return `(EXTRACT(HOUR FROM ${col}) >= 19 OR EXTRACT(HOUR FROM ${col}) < 6)`;
  return `(EXTRACT(HOUR FROM ${col}) >= ${r[0]} AND EXTRACT(HOUR FROM ${col}) < ${r[1]})`;
}

// ─── Overview KPIs ────────────────────────────────────────────────────────────

export async function getOverviewKpis(from: Date, to: Date): Promise<OverviewKpis> {
  const [onTimeResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE updated_at <= COALESCE(driver_eta_at, system_eta_at))
        / NULLIF(COUNT(*) FILTER (WHERE status = 'delivered'), 0),
      2) AS rate
    FROM deliveries
    WHERE status = 'delivered'
      AND updated_at >= ${from.toISOString()} AND updated_at <= ${to.toISOString()}
  `);

  const [fulfillResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'delivered')
        / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('draft','pending')), 0),
      2) AS rate
    FROM deliveries
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);

  const [avgTimeResult] = await db.execute<{ avg_minutes: number }>(sql`
    SELECT
      AVG(
        EXTRACT(EPOCH FROM (de_end.created_at - de_start.created_at)) / 60
      ) AS avg_minutes
    FROM delivery_events de_start
    JOIN delivery_events de_end ON de_end.delivery_id = de_start.delivery_id
    WHERE de_start.to_status = 'accepted'
      AND de_end.to_status = 'delivered'
      AND de_start.created_at >= ${from.toISOString()}
      AND de_start.created_at <= ${to.toISOString()}
  `);

  const [disputeResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status IN ('failed') AND EXISTS (
          SELECT 1 FROM delivery_events de
          WHERE de.delivery_id = deliveries.id AND de.failure_cause IS NOT NULL
        ))
        / NULLIF(COUNT(*), 0),
      2) AS rate
    FROM deliveries
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);

  const [updateFreqResult] = await db.execute<{ avg_updates: number }>(sql`
    SELECT AVG(event_count) AS avg_updates FROM (
      SELECT delivery_id, COUNT(*) AS event_count
      FROM delivery_events
      WHERE to_status = ANY(${CUSTOMER_FACING_STATUSES}::text[])
        AND created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
      GROUP BY delivery_id
    ) sub
  `);

  const [completionResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'delivered')
        / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('pending')), 0),
      2) AS rate
    FROM delivery_legs
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      AND actor_type = 'driver'
  `);

  const sparkStart = new Date(to);
  sparkStart.setUTCDate(sparkStart.getUTCDate() - 6);

  const sparkRows = await db.execute<{
    date: string;
    on_time_rate: number;
    fulfillment_rate: number;
    avg_minutes: number;
    dispute_rate: number;
    update_freq: number;
    completion_rate: number;
  }>(sql`
    SELECT
      DATE(updated_at)::text AS date,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status='delivered' AND updated_at <= COALESCE(driver_eta_at, system_eta_at))
        / NULLIF(COUNT(*) FILTER (WHERE status='delivered'), 0), 2) AS on_time_rate,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status='delivered')
        / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('draft','pending')), 0), 2) AS fulfillment_rate,
      (SELECT AVG(EXTRACT(EPOCH FROM (de_end.created_at - de_start.created_at)) / 60)
       FROM delivery_events de_start
       JOIN delivery_events de_end ON de_end.delivery_id = de_start.delivery_id
       WHERE de_start.to_status = 'accepted' AND de_end.to_status = 'delivered'
         AND DATE(de_end.created_at) = DATE(deliveries.updated_at))::numeric AS avg_minutes,
      (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE failure_cause IS NOT NULL) / NULLIF(COUNT(*), 0), 2)
       FROM delivery_events de2
       WHERE DATE(de2.created_at) = DATE(deliveries.updated_at))::numeric AS dispute_rate,
      (SELECT AVG(cnt) FROM (
         SELECT delivery_id, COUNT(*) AS cnt FROM delivery_events
         WHERE to_status = ANY(ARRAY['accepted','picked_up','en_route_dropoff','arrived_dropoff','delivered']::text[])
           AND DATE(created_at) = DATE(deliveries.updated_at)
         GROUP BY delivery_id
       ) s)::numeric AS update_freq,
      (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'delivered')
                    / NULLIF(COUNT(*) FILTER (WHERE status != 'pending'), 0), 2)
       FROM delivery_legs dl2
       WHERE DATE(dl2.created_at) = DATE(deliveries.updated_at) AND dl2.actor_type = 'driver')::numeric AS completion_rate
    FROM deliveries
    WHERE updated_at >= ${sparkStart.toISOString()} AND updated_at <= ${to.toISOString()}
    GROUP BY DATE(updated_at)
    ORDER BY date
  `);

  const toSparkline = (field: keyof typeof sparkRows[0]) =>
    sparkRows.map((r) => ({ date: r.date, value: (r[field] as number) ?? 0 }));

  return {
    onTimeRate: (onTimeResult?.rate as number) ?? 0,
    onTimeRateSparkline: toSparkline('on_time_rate'),
    fulfillmentRate: (fulfillResult?.rate as number) ?? 0,
    fulfillmentRateSparkline: toSparkline('fulfillment_rate'),
    avgDeliveryMinutes: Math.round((avgTimeResult?.avg_minutes as number) ?? 0),
    avgDeliveryMinutesSparkline: toSparkline('avg_minutes'),
    disputeRate: (disputeResult?.rate as number) ?? 0,
    disputeRateSparkline: toSparkline('dispute_rate'),
    customerUpdateFrequency: Math.round(((updateFreqResult?.avg_updates as number) ?? 0) * 10) / 10,
    customerUpdateFrequencySparkline: toSparkline('update_freq'),
    driverCompletionRate: (completionResult?.rate as number) ?? 0,
    driverCompletionRateSparkline: toSparkline('completion_rate'),
  };
}

// ─── Delivery Performance ─────────────────────────────────────────────────────

export async function getDeliveryPerformance(from: Date, to: Date): Promise<DeliveryPerformanceData> {
  const dailyRows = await db.execute<{ date: string; rate: number }>(sql`
    SELECT
      DATE(updated_at)::text AS date,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status='delivered' AND updated_at <= COALESCE(driver_eta_at, system_eta_at))
        / NULLIF(COUNT(*) FILTER (WHERE status='delivered'), 0),
      2) AS rate
    FROM deliveries
    WHERE updated_at >= ${from.toISOString()} AND updated_at <= ${to.toISOString()}
    GROUP BY DATE(updated_at)
    ORDER BY date
  `);

  const dailyOnTimeRate: DailyOnTimePoint[] = dailyRows.map((r, i) => ({
    date: r.date,
    rate: (r.rate as number) ?? 0,
    isAnomaly: i > 0 ? (((dailyRows[i - 1].rate as number) ?? 0) - ((r.rate as number) ?? 0)) > 10 : false,
  }));

  const volumeRows = await db.execute<{ status: string; count: number }>(sql`
    SELECT status, COUNT(*)::int AS count
    FROM deliveries
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      AND status IN ('delivered', 'failed', 'cancelled', 'returned')
    GROUP BY status
    ORDER BY count DESC
  `);

  const phaseRows = await db.execute<{ leg_type: string; avg_minutes: number; sla_hours: number }>(sql`
    SELECT
      leg_type,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)::int AS avg_minutes,
      AVG(sla_hours) AS sla_hours
    FROM delivery_legs
    WHERE completed_at IS NOT NULL AND started_at IS NOT NULL
      AND created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
    GROUP BY leg_type
  `);

  const lateRows = await db.execute<{ bucket: string; count: number }>(sql`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))) / 60 BETWEEN 0 AND 15 THEN '0-15 min'
        WHEN EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))) / 60 BETWEEN 15 AND 30 THEN '15-30 min'
        WHEN EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))) / 60 BETWEEN 30 AND 60 THEN '30-60 min'
        ELSE '>60 min'
      END AS bucket,
      COUNT(*)::int AS count
    FROM deliveries
    WHERE status = 'delivered'
      AND updated_at > COALESCE(driver_eta_at, system_eta_at)
      AND updated_at >= ${from.toISOString()} AND updated_at <= ${to.toISOString()}
    GROUP BY bucket
    ORDER BY MIN(EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))))
  `);

  return {
    dailyOnTimeRate,
    volumeByOutcome: volumeRows.map((r) => ({ status: r.status, count: r.count as number })),
    phaseBreakdown: phaseRows.map((r) => ({
      legType: r.leg_type,
      avgMinutes: Math.round((r.avg_minutes as number) ?? 0),
      slaHours: (r.sla_hours as number) ?? 1,
    })),
    lateDistribution: lateRows.map((r) => ({ bucket: r.bucket, count: r.count as number })),
  };
}

// ─── Driver Performance ───────────────────────────────────────────────────────

export async function getDriverPerformance(from: Date, to: Date): Promise<DriverPerformanceRow[]> {
  const rows = await db.execute<{
    driver_id: string;
    name: string;
    total_legs: number;
    on_time_pct: number;
    completion_pct: number;
    avg_rating: number;
  }>(sql`
    WITH rated AS (
      SELECT driver_id, AVG(rating)::numeric AS avg_rating
      FROM delivery_ratings
      WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      GROUP BY driver_id
    )
    SELECT
      dr.id AS driver_id,
      u.name,
      COUNT(DISTINCT dl.id)::int AS total_legs,
      ROUND(
        100.0 * COUNT(DISTINCT dl.id) FILTER (
          WHERE dl.completed_at IS NOT NULL
            AND dl.completed_at <= COALESCE(dl.driver_eta_at, dl.system_eta_at)
        ) / NULLIF(COUNT(DISTINCT dl.id) FILTER (WHERE dl.completed_at IS NOT NULL), 0),
      2)::numeric AS on_time_pct,
      ROUND(
        100.0 * COUNT(DISTINCT dl.id) FILTER (WHERE dl.status = 'delivered')
        / NULLIF(COUNT(DISTINCT dl.id) FILTER (WHERE dl.status != 'pending'), 0),
      2)::numeric AS completion_pct,
      COALESCE(rated.avg_rating, 0) AS avg_rating
    FROM delivery_legs dl
    JOIN drivers dr ON dr.id = dl.actor_id
    JOIN users u ON u.id = dr.user_id
    LEFT JOIN rated ON rated.driver_id = dr.id
    WHERE dl.actor_type = 'driver'
      AND dl.created_at >= ${from.toISOString()} AND dl.created_at <= ${to.toISOString()}
    GROUP BY dr.id, u.name, rated.avg_rating
    ORDER BY total_legs DESC
  `);

  return rows.map((r) => {
    const completion = (r.completion_pct as number) ?? 0;
    const onTime = (r.on_time_pct as number) ?? 0;
    const ghost = 0; // ghost_rate removed: the delivery_events join caused a Cartesian product
    const reliabilityScore = Math.round(
      (completion * 0.4 + onTime * 0.35 + (100 - ghost) * 0.25) * 10,
    ) / 10;
    return {
      driverId: r.driver_id,
      name: r.name,
      totalLegs: r.total_legs as number,
      onTimePct: onTime,
      completionPct: completion,
      ghostRate: ghost,
      avgRating: Math.round(((r.avg_rating as number) ?? 0) * 10) / 10,
      reliabilityScore,
    };
  });
}

// ─── Carrier Performance ──────────────────────────────────────────────────────

export async function getCarrierPerformance(from: Date, to: Date): Promise<CarrierPerformanceData> {
  const rows = await db.execute<{
    carrier_id: string;
    name: string;
    avg_actual_hours: number;
    sla_hours: number;
    fulfillment_pct: number;
  }>(sql`
    SELECT
      dl.actor_id AS carrier_id,
      c.name,
      AVG(EXTRACT(EPOCH FROM (dl.completed_at - dl.started_at)) / 3600) AS avg_actual_hours,
      AVG(COALESCE(cso.sla_hours, dl.sla_hours, 24)) AS sla_hours,
      ROUND(
        100.0 * COUNT(dl.id) FILTER (WHERE dl.status = 'delivered')
        / NULLIF(COUNT(dl.id) FILTER (WHERE dl.status != 'pending'), 0),
      2) AS fulfillment_pct
    FROM delivery_legs dl
    JOIN carriers c ON c.id = dl.actor_id
    LEFT JOIN carrier_sla_overrides cso
      ON cso.carrier_id = dl.actor_id
      AND cso.origin_zone = dl.pickup_zone
      AND cso.destination_zone = dl.dropoff_zone
    WHERE dl.actor_type = 'carrier'
      AND dl.created_at >= ${from.toISOString()} AND dl.created_at <= ${to.toISOString()}
    GROUP BY dl.actor_id, c.name
    ORDER BY avg_actual_hours ASC
  `);

  const [overrideResult] = await db.execute<{ configured: number; total: number }>(sql`
    SELECT
      COUNT(DISTINCT (dl.actor_id, dl.pickup_zone, dl.dropoff_zone)) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM carrier_sla_overrides cso
          WHERE cso.carrier_id = dl.actor_id
            AND cso.origin_zone = dl.pickup_zone
            AND cso.destination_zone = dl.dropoff_zone
        )
      )::int AS configured,
      COUNT(DISTINCT (dl.actor_id, dl.pickup_zone, dl.dropoff_zone))::int AS total
    FROM delivery_legs dl
    WHERE dl.actor_type = 'carrier'
      AND dl.created_at >= ${from.toISOString()} AND dl.created_at <= ${to.toISOString()}
  `);

  return {
    rows: rows.map((r) => {
      const avgActual = (r.avg_actual_hours as number) ?? 0;
      const sla = (r.sla_hours as number) ?? 24;
      return {
        carrierId: r.carrier_id,
        name: r.name,
        avgActualHours: Math.round(avgActual * 10) / 10,
        slaHours: sla,
        adherencePct: Math.round(Math.min(100, (sla / Math.max(avgActual, 0.1)) * 100) * 10) / 10,
        fulfillmentPct: (r.fulfillment_pct as number) ?? 0,
      };
    }),
    overrideCoverage: {
      configured: (overrideResult?.configured as number) ?? 0,
      total: (overrideResult?.total as number) ?? 0,
    },
  };
}

// ─── Customer Experience ──────────────────────────────────────────────────────

export async function getCustomerExperience(from: Date, to: Date): Promise<CustomerExperienceData> {
  const freqTrend = await db.execute<{ date: string; avg_updates: number }>(sql`
    SELECT
      counts.day::text AS date,
      AVG(counts.cnt) AS avg_updates
    FROM (
      SELECT delivery_id, DATE(created_at) AS day, COUNT(*) AS cnt
      FROM delivery_events
      WHERE to_status = ANY(${CUSTOMER_FACING_STATUSES}::text[])
        AND created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      GROUP BY delivery_id, DATE(created_at)
    ) counts
    GROUP BY counts.day
    ORDER BY date
  `);

  const [avgFreqResult] = await db.execute<{ avg: number }>(sql`
    SELECT AVG(cnt) AS avg FROM (
      SELECT delivery_id, COUNT(*) AS cnt
      FROM delivery_events
      WHERE to_status = ANY(${CUSTOMER_FACING_STATUSES}::text[])
        AND created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
      GROUP BY delivery_id
    ) s
  `);

  const disputeTrend = await db.execute<{ date: string; rate: number }>(sql`
    SELECT
      DATE(created_at)::text AS date,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE failure_cause IS NOT NULL)
        / NULLIF(COUNT(*), 0),
      2) AS rate
    FROM delivery_events
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
    GROUP BY DATE(created_at)
    ORDER BY date
  `);

  const [avgDisputeResult] = await db.execute<{ rate: number }>(sql`
    SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE failure_cause IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS rate
    FROM delivery_events
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);

  const [resolutionResult] = await db.execute<{ avg_hours: number }>(sql`
    SELECT AVG(
      EXTRACT(EPOCH FROM (de_resolve.created_at - de_open.created_at)) / 3600
    ) AS avg_hours
    FROM delivery_events de_open
    JOIN delivery_events de_resolve ON de_resolve.delivery_id = de_open.delivery_id
      AND de_resolve.to_status = 'delivered'
      AND de_resolve.created_at > de_open.created_at
    WHERE de_open.failure_cause IS NOT NULL
      AND de_open.created_at >= ${from.toISOString()} AND de_open.created_at <= ${to.toISOString()}
  `);

  const now = to;
  const cutoff30 = new Date(now);
  cutoff30.setUTCDate(cutoff30.getUTCDate() - 30);
  const cutoff60 = new Date(now);
  cutoff60.setUTCDate(cutoff60.getUTCDate() - 60);

  const [repeat30] = await db.execute<{ rate: number }>(sql`
    SELECT ROUND(
      100.0 * COUNT(DISTINCT repeat.customer_id) / NULLIF(COUNT(DISTINCT first.customer_id), 0),
    2) AS rate
    FROM deliveries first
    LEFT JOIN deliveries repeat
      ON repeat.customer_id = first.customer_id
      AND repeat.id != first.id
      AND repeat.created_at BETWEEN ${cutoff30.toISOString()} AND ${now.toISOString()}
    WHERE first.created_at >= ${from.toISOString()} AND first.created_at <= ${to.toISOString()}
  `);

  const [repeat60] = await db.execute<{ rate: number }>(sql`
    SELECT ROUND(
      100.0 * COUNT(DISTINCT repeat.customer_id) / NULLIF(COUNT(DISTINCT first.customer_id), 0),
    2) AS rate
    FROM deliveries first
    LEFT JOIN deliveries repeat
      ON repeat.customer_id = first.customer_id
      AND repeat.id != first.id
      AND repeat.created_at BETWEEN ${cutoff60.toISOString()} AND ${now.toISOString()}
    WHERE first.created_at >= ${from.toISOString()} AND first.created_at <= ${to.toISOString()}
  `);

  return {
    updateFrequencyTrend: freqTrend.map((r) => ({ date: r.date, value: (r.avg_updates as number) ?? 0 })),
    avgUpdateFrequency: Math.round(((avgFreqResult?.avg as number) ?? 0) * 10) / 10,
    disputeRateTrend: disputeTrend.map((r) => ({ date: r.date, value: (r.rate as number) ?? 0 })),
    avgDisputeRate: (avgDisputeResult?.rate as number) ?? 0,
    avgResolutionHours: Math.round(((resolutionResult?.avg_hours as number) ?? 0) * 10) / 10,
    repeatRate30d: (repeat30?.rate as number) ?? 0,
    repeatRate60d: (repeat60?.rate as number) ?? 0,
  };
}

// ─── Root Cause ────────────────────────────────────────────────────────────────

export async function getRootCause(params: RootCauseParams): Promise<RootCauseData> {
  const { start, end, zone, driverId, carrierId, legType, timeOfDay } = params;

  const zoneClause = zone ? sql`AND dl.dropoff_zone = ${zone}` : sql``;
  const driverClause = driverId ? sql`AND dl.actor_id = ${driverId} AND dl.actor_type = 'driver'` : sql``;
  const carrierClause = carrierId ? sql`AND dl.actor_id = ${carrierId} AND dl.actor_type = 'carrier'` : sql``;
  const legTypeClause = legType ? sql`AND dl.leg_type = ${legType}` : sql``;
  const todClause = timeOfDay ? sql.raw(timeOfDayFilter('de.created_at', timeOfDay)) : sql.raw('TRUE');

  const decomp = await db.execute<{ cause: string; count: number }>(sql`
    SELECT
      COALESCE(de.failure_cause, 'unknown') AS cause,
      COUNT(*)::int AS count
    FROM delivery_events de
    JOIN delivery_legs dl ON dl.id = de.leg_id
    WHERE de.created_at >= ${start.toISOString()} AND de.created_at <= ${end.toISOString()}
      AND de.failure_cause IS NOT NULL
      AND ${todClause}
      ${zoneClause}
      ${driverClause}
      ${carrierClause}
      ${legTypeClause}
    GROUP BY cause
    ORDER BY count DESC
  `);

  const total = decomp.reduce((s, r) => s + (r.count as number), 0);
  const failureDecomposition: FailureShare[] = decomp.map((r) => ({
    cause: r.cause,
    count: r.count as number,
    pct: total > 0 ? Math.round(((r.count as number) / total) * 100 * 10) / 10 : 0,
  }));

  const topRows = await db.execute<{
    actor_type: string;
    actor_id: string;
    name: string;
    late_count: number;
    avg_late_minutes: number;
    top_zone: string;
    top_tod: string;
  }>(sql`
    SELECT
      dl.actor_type,
      dl.actor_id,
      COALESCE(u.name, c.name, 'Unknown') AS name,
      COUNT(*)::int AS late_count,
      AVG(
        EXTRACT(EPOCH FROM (dl.completed_at - COALESCE(dl.driver_eta_at, dl.system_eta_at))) / 60
      )::int AS avg_late_minutes,
      MODE() WITHIN GROUP (ORDER BY dl.dropoff_zone) AS top_zone,
      MODE() WITHIN GROUP (ORDER BY
        CASE
          WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 6 AND 10 THEN 'morning'
          WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 10 AND 15 THEN 'midday'
          WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 15 AND 19 THEN 'evening'
          ELSE 'night'
        END
      ) AS top_tod
    FROM delivery_legs dl
    LEFT JOIN drivers dr ON dr.id = dl.actor_id AND dl.actor_type = 'driver'
    LEFT JOIN users u ON u.id = dr.user_id
    LEFT JOIN carriers c ON c.id = dl.actor_id AND dl.actor_type = 'carrier'
    WHERE dl.completed_at > COALESCE(dl.driver_eta_at, dl.system_eta_at)
      AND dl.completed_at IS NOT NULL
      AND dl.created_at >= ${start.toISOString()} AND dl.created_at <= ${end.toISOString()}
      ${zoneClause}
      ${legTypeClause}
    GROUP BY dl.actor_type, dl.actor_id, COALESCE(u.name, c.name, 'Unknown')
    ORDER BY late_count DESC
    LIMIT 5
  `);

  const heatRows = await db.execute<{ zone: string; time_of_day: string; avg_delay: number }>(sql`
    SELECT
      COALESCE(dl.dropoff_zone, 'Other') AS zone,
      CASE
        WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 6 AND 10 THEN 'morning'
        WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 10 AND 15 THEN 'midday'
        WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 15 AND 19 THEN 'evening'
        ELSE 'night'
      END AS time_of_day,
      AVG(
        EXTRACT(EPOCH FROM (dl.completed_at - COALESCE(dl.driver_eta_at, dl.system_eta_at))) / 60
      )::int AS avg_delay
    FROM delivery_legs dl
    WHERE dl.completed_at > COALESCE(dl.driver_eta_at, dl.system_eta_at)
      AND dl.completed_at IS NOT NULL
      AND dl.created_at >= ${start.toISOString()} AND dl.created_at <= ${end.toISOString()}
    GROUP BY zone, time_of_day
  `);

  return {
    failureDecomposition,
    topContributors: topRows.map((r) => ({
      actorType: r.actor_type as 'driver' | 'carrier',
      actorId: r.actor_id,
      name: r.name,
      lateCount: r.late_count as number,
      avgMinutesLate: r.avg_late_minutes as number,
      topZone: (r.top_zone as string) ?? 'Other',
      topTimeOfDay: (r.top_tod as string) ?? 'midday',
    })),
    heatmap: heatRows.map((r) => ({
      zone: r.zone,
      timeOfDay: r.time_of_day,
      avgDelayMinutes: (r.avg_delay as number) ?? 0,
    })),
  };
}
