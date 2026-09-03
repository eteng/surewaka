// Feature: saved-recipients-contact-book, Property 5: Validation reuse
//
// For any candidate create or update payload, the API's accept/reject decision
// SHALL equal the decision of `recipientDetailsSchema` from @surewaka/shared
// (name 2–100, phone ^(\+234|0)[789][01]\d{8}$, notes ≤200) combined with the
// label rule (optional string ≤50): the payload is persisted iff that combined
// schema accepts it, and rejected payloads yield HTTP 400 and are never
// persisted. No carrier-specific digit-pattern validation is applied beyond the
// shared phone regex.
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import fc from 'fast-check';
import {
  createSavedRecipientSchema,
  updateSavedRecipientSchema,
} from '@surewaka/shared';
import { stubAuthModule, personas } from '../../test-utils/auth-mock';

// ── Mocks ──────────────────────────────────────────────────────────────────
// Auth always passes with a fixed customer — Property 5 is about validation, not
// auth. The service is mocked so we can spy on whether the route forwarded a
// payload to it; the route must only call the service for payloads the schema
// accepts.
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../services/recipient-service', () => ({
  listRecipients: vi.fn(),
  getRecipient: vi.fn(),
  createRecipient: (...args: unknown[]) => mockCreate(...args),
  updateRecipient: (...args: unknown[]) => mockUpdate(...args),
  deleteRecipient: vi.fn(),
}));

vi.mock('../../middleware/auth', () => stubAuthModule(personas.customer()));

async function createTestApp() {
  const { default: recipientRoutes } = await import('../recipients');
  const app = new Hono();
  app.route('/api/v1/recipients', recipientRoutes);
  return app;
}

// A SavedRecipient created by the service on the accept path. Shape is irrelevant
// to Property 5 (which is about the accept/reject decision), so return a fixed
// valid-looking row.
const FAKE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  recipientName: 'Placeholder',
  recipientPhone: '08012345678',
  deliveryNotes: undefined,
  label: undefined,
  created_at: new Date().toISOString(),
};

// ── Arbitraries ──────────────────────────────────────────────────────────────
// Generators intentionally span the boundaries the schema cares about so the
// property exercises both accept and reject decisions:
//   - names shorter than 2, in-range, and longer than 100
//   - phones that match and violate the Nigerian mobile regex (incl. unicode/ws)
//   - notes at/over 200 chars and absent
//   - labels at/over 50 chars and absent

const validNameArb = fc.string({ minLength: 2, maxLength: 100 });
const nameArb = fc.oneof(
  validNameArb,
  fc.string({ minLength: 0, maxLength: 1 }), // too short
  fc.string({ minLength: 101, maxLength: 130 }), // too long
  fc.constant(''),
);

const validPhoneArb = fc
  .tuple(
    fc.constantFrom('+234', '0'),
    fc.constantFrom('7', '8', '9'),
    fc.constantFrom('0', '1'),
    fc.stringMatching(/^\d{8}$/),
  )
  .map(([prefix, a, b, rest]) => `${prefix}${a}${b}${rest}`);

const phoneArb = fc.oneof(
  validPhoneArb,
  fc.string(), // arbitrary junk — usually invalid
  fc.constant('1234567890'),
  fc.constant('+2348012345678 '), // trailing whitespace → invalid
  fc.constant('080123456789'), // one digit too many
  fc.constant('0801234567'), // one digit too few
  fc.constant('☎08012345678'), // unicode prefix
);

const notesArb = fc.oneof(
  fc.constant(undefined),
  fc.string({ maxLength: 200 }),
  fc.string({ minLength: 201, maxLength: 240 }), // too long
);

const labelArb = fc.oneof(
  fc.constant(undefined),
  fc.string({ maxLength: 50 }),
  fc.string({ minLength: 51, maxLength: 80 }), // too long
);

// Body may include arbitrary extra keys and omit required keys, mirroring a real
// untrusted client. `.oneof(undefined, ...)` lets each field be present or missing.
const bodyArb = fc.record(
  {
    recipientName: fc.oneof(fc.constant(undefined), nameArb),
    recipientPhone: fc.oneof(fc.constant(undefined), phoneArb),
    deliveryNotes: notesArb,
    label: labelArb,
    // A stray body field that must never influence validation/persistence.
    user_id: fc.oneof(fc.constant(undefined), fc.string()),
  },
  { requiredKeys: [] },
);

describe('Property 5: Validation reuse (route accept/reject == shared schema)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ data: FAKE_ROW, error: null, meta: null });
    mockUpdate.mockResolvedValue({ data: FAKE_ROW, error: null, meta: null });
  });

  it('POST / accepts iff createSavedRecipientSchema accepts, never persists rejects', async () => {
    const app = await createTestApp();

    await fc.assert(
      fc.asyncProperty(bodyArb, async (body) => {
        mockCreate.mockClear();

        const expected = createSavedRecipientSchema.safeParse(body);

        const res = await app.request('/api/v1/recipients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
          body: JSON.stringify(body),
        });

        if (expected.success) {
          // Accepted by the schema → route must forward to the service and not 400.
          expect(res.status).not.toBe(400);
          expect(mockCreate).toHaveBeenCalledTimes(1);
        } else {
          // Rejected by the schema → route must 400 VALIDATION_ERROR and never persist.
          expect(res.status).toBe(400);
          const json = (await res.json()) as { error: { code: string } | null };
          expect(json.error?.code).toBe('VALIDATION_ERROR');
          expect(mockCreate).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('PUT /:id accepts iff updateSavedRecipientSchema accepts, never persists rejects', async () => {
    const app = await createTestApp();
    const id = '22222222-2222-4222-8222-222222222222';

    await fc.assert(
      fc.asyncProperty(bodyArb, async (body) => {
        mockUpdate.mockClear();

        const expected = updateSavedRecipientSchema.safeParse(body);

        const res = await app.request(`/api/v1/recipients/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
          body: JSON.stringify(body),
        });

        if (expected.success) {
          expect(res.status).not.toBe(400);
          expect(mockUpdate).toHaveBeenCalledTimes(1);
        } else {
          expect(res.status).toBe(400);
          const json = (await res.json()) as { error: { code: string } | null };
          expect(json.error?.code).toBe('VALIDATION_ERROR');
          expect(mockUpdate).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 200 },
    );
  });
});
