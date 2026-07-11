// Feature: pricing-transparency
// Admin carrier rate management — update carrier basePrice with audit logging.
// Admin carrier margin reconciliation — POST/GET reconciliation records.

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import { db, carriers, carrierRateHistory, carrierInvoiceReconciliations, quotes } from '@surewaka/db';
import { eq, and, gte, lt, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';

type Env = { Variables: { user: AuthUser } };

const adminCarrierRates = new Hono<Env>();

adminCarrierRates.use('*', requireAuth);
adminCarrierRates.use('*', requireRole('surewaka_admin'));

const updateRateSchema = z.object({
  basePrice: z.number().int().positive('basePrice must be a positive integer (kobo)'),
  reason: z.string().optional(),
});

// PATCH /:id/rate — update a carrier's basePrice and log the change
adminCarrierRates.patch('/:id/rate', async (c) => {
  const user = c.get('user');
  const carrierId = c.req.param('id');

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateRateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const { basePrice, reason } = parsed.data;

  // Load current carrier
  const [carrier] = await db
    .select()
    .from(carriers)
    .where(eq(carriers.id, carrierId))
    .limit(1);

  if (!carrier) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Carrier not found' },
        meta: null,
      },
      404,
    );
  }

  const oldBasePrice = carrier.basePrice;

  // Update carrier basePrice
  const [updatedCarrier] = await db
    .update(carriers)
    .set({ basePrice, updatedAt: new Date() })
    .where(eq(carriers.id, carrierId))
    .returning();

  // Insert audit log row
  const [historyEntry] = await db
    .insert(carrierRateHistory)
    .values({
      carrierId,
      oldBasePriceKobo: oldBasePrice,
      newBasePriceKobo: basePrice,
      changedBy: user.id,
      reason: reason ?? null,
    })
    .returning();

  return c.json({
    data: {
      carrier: updatedCarrier,
      historyEntry,
    },
    error: null,
    meta: null,
  });
});

// --- Carrier Invoice Reconciliation Routes ---

const adminCarrierReconciliations = new Hono<Env>();

adminCarrierReconciliations.use('*', requireAuth);
adminCarrierReconciliations.use('*', requireRole('surewaka_admin'));

const createReconciliationSchema = z.object({
  carrier_id: z.string().uuid('carrier_id must be a valid UUID'),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'period_start must be YYYY-MM-DD'),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'period_end must be YYYY-MM-DD'),
  invoiced_amount_kobo: z.number().int('invoiced_amount_kobo must be an integer'),
  notes: z.string().optional(),
});

// POST / — create a reconciliation entry
adminCarrierReconciliations.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json().catch(() => ({}));
  const parsed = createReconciliationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const { carrier_id, period_start, period_end, invoiced_amount_kobo, notes } = parsed.data;

  // Validate carrier exists
  const [carrier] = await db
    .select({ id: carriers.id })
    .from(carriers)
    .where(eq(carriers.id, carrier_id))
    .limit(1);

  if (!carrier) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Carrier not found' },
        meta: null,
      },
      404,
    );
  }

  // Compute quoted_carrier_total_kobo:
  // Sum "Carrier rate" line items from confirmed quotes for this carrier in [period_start, period_end)
  const confirmedQuotes = await db
    .select({ lineItems: quotes.lineItems })
    .from(quotes)
    .where(
      and(
        eq(quotes.carrierId, carrier_id),
        isNotNull(quotes.confirmedAt),
        gte(quotes.createdAt, new Date(period_start)),
        lt(quotes.createdAt, new Date(period_end)),
      ),
    );

  // Extract "Carrier rate" line items and sum their amounts
  let quotedCarrierTotalKobo = 0;
  for (const quote of confirmedQuotes) {
    const lineItems = quote.lineItems as Array<{ label: string; amountKobo: number }>;
    if (Array.isArray(lineItems)) {
      for (const item of lineItems) {
        if (item.label && item.label.startsWith('Carrier rate')) {
          quotedCarrierTotalKobo += item.amountKobo ?? 0;
        }
      }
    }
  }

  const varianceKobo = quotedCarrierTotalKobo - invoiced_amount_kobo;

  // Insert the reconciliation record
  const [record] = await db
    .insert(carrierInvoiceReconciliations)
    .values({
      carrierId: carrier_id,
      periodStart: period_start,
      periodEnd: period_end,
      invoicedAmountKobo: invoiced_amount_kobo,
      quotedCarrierTotalKobo: quotedCarrierTotalKobo,
      varianceKobo,
      enteredBy: user.id,
      notes: notes ?? null,
    })
    .returning();

  return c.json(
    {
      data: record,
      error: null,
      meta: null,
    },
    201,
  );
});

// GET / — list reconciliation records, optionally filtered by carrier_id
adminCarrierReconciliations.get('/', async (c) => {
  const carrierId = c.req.query('carrier_id');

  const conditions = carrierId
    ? eq(carrierInvoiceReconciliations.carrierId, carrierId)
    : undefined;

  const records = await db
    .select()
    .from(carrierInvoiceReconciliations)
    .where(conditions)
    .orderBy(sql`${carrierInvoiceReconciliations.createdAt} DESC`);

  return c.json({
    data: records,
    error: null,
    meta: { count: records.length },
  });
});

export { adminCarrierReconciliations };
export default adminCarrierRates;
