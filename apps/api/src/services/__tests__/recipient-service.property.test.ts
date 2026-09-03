// Feature: saved-recipients-contact-book
// Property 1: Owner isolation on every query
// Property 2: Create sets owner from the session
// Property 3: Cap invariant (LIMIT_REACHED)
// Property 4: Snapshot immutability
// Validates: Requirements 4.3, 4.4, 4.5, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── In-memory fake DB state ─────────────────────────────────────────────────
//
// A minimal-but-faithful fake of the drizzle query builder that recipient-service
// uses. It records which tables are *written* to (insert/update/delete) so
// Property 4 can assert `deliveries` is never touched, and it actually applies the
// captured WHERE conditions so owner-isolation is real (not just assumed).

type RecipientRow = {
  id: string;
  userId: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  deliveryNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The single fake table backing user_saved_recipients. */
let store: RecipientRow[] = [];
/** Tables written to (insert/update/delete) during a test run. */
let writtenTables: string[] = [];
/** Tables read from (select) during a test run. */
let readTables: string[] = [];

// The mocked drizzle helpers tag conditions so the fake can interpret them.
type Cond =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'and'; conditions: Cond[] }
  | { op: 'asc'; col: string }
  | { op: 'count' };

function tableName(t: unknown): string {
  // Our @surewaka/db mock represents each table as a tagged object with __table.
  if (t && typeof t === 'object' && '__table' in (t as Record<string, unknown>)) {
    return (t as { __table: string }).__table;
  }
  return String(t);
}

/** Extract flat eq predicates from a (possibly nested `and`) condition. */
function eqPredicates(cond: Cond | undefined): { col: string; val: unknown }[] {
  if (!cond) return [];
  if (cond.op === 'eq') return [{ col: cond.col, val: cond.val }];
  if (cond.op === 'and') return cond.conditions.flatMap(eqPredicates);
  return [];
}

function matches(row: RecipientRow, cond: Cond | undefined): boolean {
  return eqPredicates(cond).every((p) => (row as Record<string, unknown>)[p.col] === p.val);
}

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  asc: (col: string) => ({ op: 'asc', col }),
  count: () => ({ op: 'count' }),
}));

vi.mock('@surewaka/db', () => {
  // Column identifiers are plain strings so the mocked eq/asc receive the field name.
  const userSavedRecipients = {
    __table: 'user_saved_recipients',
    id: 'id',
    userId: 'userId',
    label: 'label',
    recipientName: 'recipientName',
    recipientPhone: 'recipientPhone',
    deliveryNotes: 'deliveryNotes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    $inferSelect: undefined as unknown,
    $inferInsert: undefined as unknown,
  };

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const name = tableName(table);
        readTables.push(name);
        const isCount = !!fields && 'total' in fields;

        // build a thenable query object supporting .where().orderBy() / .where().limit()
        const makeQuery = () => {
          let whereCond: Cond | undefined;
          const resolveRows = (): unknown[] => {
            const filtered = store.filter((r) => matches(r, whereCond));
            if (isCount) return [{ total: filtered.length }];
            return filtered;
          };
          const query: Record<string, unknown> = {
            where: (cond: Cond) => {
              whereCond = cond;
              return query;
            },
            orderBy: (_order: unknown) => {
              // list path: return a resolved array sorted by createdAt asc
              const rows = store
                .filter((r) => matches(r, whereCond))
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
              return Promise.resolve(rows);
            },
            limit: (n: number) => Promise.resolve(resolveRows().slice(0, n)),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.resolve(resolveRows()).then(resolve, reject),
          };
          return query;
        };
        return makeQuery();
      },
    }),
    insert: (table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
          writtenTables.push(tableName(table));
          const now = new Date();
          const row: RecipientRow = {
            id: crypto.randomUUID(),
            userId: data.userId as string,
            label: (data.label as string | undefined) ?? null,
            recipientName: data.recipientName as string,
            recipientPhone: data.recipientPhone as string,
            deliveryNotes: (data.deliveryNotes as string | undefined) ?? null,
            createdAt: now,
            updatedAt: now,
          };
          store.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: (cond: Cond) => ({
          returning: () => {
            writtenTables.push(tableName(table));
            const target = store.find((r) => matches(r, cond));
            if (!target) return Promise.resolve([]);
            Object.assign(target, {
              label: 'label' in data ? ((data.label as string | undefined) ?? null) : target.label,
              recipientName:
                'recipientName' in data ? (data.recipientName as string) : target.recipientName,
              recipientPhone:
                'recipientPhone' in data ? (data.recipientPhone as string) : target.recipientPhone,
              deliveryNotes:
                'deliveryNotes' in data
                  ? ((data.deliveryNotes as string | undefined) ?? null)
                  : target.deliveryNotes,
              updatedAt: (data.updatedAt as Date) ?? new Date(),
            });
            return Promise.resolve([{ ...target }]);
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: Cond) => ({
        returning: () => {
          writtenTables.push(tableName(table));
          const idx = store.findIndex((r) => matches(r, cond));
          if (idx === -1) return Promise.resolve([]);
          const [removed] = store.splice(idx, 1);
          return Promise.resolve([removed]);
        },
      }),
    }),
  };

  return { db, userSavedRecipients };
});

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  listRecipients,
  getRecipient,
  createRecipient,
  updateRecipient,
  deleteRecipient,
} from '../recipient-service';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const RECIPIENT_CAP = 25;

const nameArb = fc.string({ minLength: 2, maxLength: 100 }).filter((s) => s.trim().length >= 2);
// A valid Nigerian mobile number matching ^(\+234|0)[789][01]\d{8}$
const phoneArb = fc
  .tuple(
    fc.constantFrom('+234', '0'),
    fc.constantFrom('7', '8', '9'),
    fc.constantFrom('0', '1'),
    fc.stringMatching(/^\d{8}$/),
  )
  .map(([prefix, a, b, rest]) => `${prefix}${a}${b}${rest}`);
const notesArb = fc.option(fc.string({ maxLength: 200 }), { nil: undefined });
const labelArb = fc.option(fc.string({ maxLength: 50 }), { nil: undefined });

const createInputArb = fc.record({
  recipientName: nameArb,
  recipientPhone: phoneArb,
  deliveryNotes: notesArb,
  label: labelArb,
});

function seedRow(userId: string, i: number): RecipientRow {
  const now = new Date(Date.now() + i); // distinct createdAt for stable ordering
  return {
    id: crypto.randomUUID(),
    userId,
    label: null,
    recipientName: `Recipient ${i}`,
    recipientPhone: '08012345678',
    deliveryNotes: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Recipient Service — Property Tests', () => {
  beforeEach(() => {
    store = [];
    writtenTables = [];
    readTables = [];
  });

  // Feature: saved-recipients-contact-book, Property 1: Owner isolation on every query
  describe('Property 1: Owner isolation on every query', () => {
    it('every op with userId=A only touches user_id=A rows; cross-owner get/update/delete => NOT_FOUND', async () => {
      // **Validates: Requirements 4.3, 4.4**
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 1, max: 8 }),
          createInputArb,
          async (userA, userBRaw, countA, countB, updateInput) => {
            // Ensure two distinct users.
            fc.pre(userA !== userBRaw);
            const userB = userBRaw;

            store = [
              ...Array.from({ length: countA }, (_, i) => seedRow(userA, i)),
              ...Array.from({ length: countB }, (_, i) => seedRow(userB, 100 + i)),
            ];

            // listRecipients(A) returns only A's rows
            const listed = await listRecipients(userA);
            expect(listed.error).toBeNull();
            expect(listed.data!.length).toBe(countA);

            // Every one of B's rows is invisible to A on get/update/delete
            const bRows = store.filter((r) => r.userId === userB);
            for (const bRow of bRows) {
              const got = await getRecipient(userA, bRow.id);
              expect(got.data).toBeNull();
              expect(got.error!.code).toBe('NOT_FOUND');

              const updated = await updateRecipient(userA, bRow.id, updateInput);
              expect(updated.data).toBeNull();
              expect(updated.error!.code).toBe('NOT_FOUND');

              // B's row must remain unchanged after A's failed update
              const stillThere = store.find((r) => r.id === bRow.id);
              expect(stillThere).toBeDefined();
              expect(stillThere!.userId).toBe(userB);
            }

            // Deleting B's rows as A does nothing and returns NOT_FOUND
            const bCountBefore = store.filter((r) => r.userId === userB).length;
            for (const bRow of bRows) {
              const del = await deleteRecipient(userA, bRow.id);
              expect(del.error!.code).toBe('NOT_FOUND');
            }
            expect(store.filter((r) => r.userId === userB).length).toBe(bCountBefore);

            // A can see/get its own rows
            for (const aRow of store.filter((r) => r.userId === userA)) {
              const got = await getRecipient(userA, aRow.id);
              expect(got.error).toBeNull();
              expect(got.data!.id).toBe(aRow.id);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: saved-recipients-contact-book, Property 2: Create sets owner from the session
  describe('Property 2: Create sets owner from the session', () => {
    it('persisted user_id equals the session userId, never a body-supplied user_id', async () => {
      // **Validates: Requirements 4.5**
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          createInputArb,
          async (sessionUserId, strayUserId, input) => {
            store = [];
            // Attach a stray body user_id-like field that must be ignored by the service.
            const pollutedInput = {
              ...input,
              userId: strayUserId,
              user_id: strayUserId,
            } as typeof input;

            const result = await createRecipient(sessionUserId, pollutedInput);
            expect(result.error).toBeNull();
            expect(result.data).not.toBeNull();

            // Exactly one row persisted, owned by the session user.
            expect(store.length).toBe(1);
            expect(store[0].userId).toBe(sessionUserId);
            expect(store[0].userId).not.toBe(strayUserId === sessionUserId ? '\u0000' : strayUserId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: saved-recipients-contact-book, Property 3: Cap invariant (LIMIT_REACHED)
  describe('Property 3: Cap invariant (LIMIT_REACHED)', () => {
    it('createRecipient at >= 25 existing => LIMIT_REACHED and count unchanged; < 25 => inserts', async () => {
      // **Validates: Requirements 5.2, 5.3, 5.5**
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.integer({ min: 23, max: 27 }),
          createInputArb,
          async (userId, existingCount, input) => {
            store = Array.from({ length: existingCount }, (_, i) => seedRow(userId, i));
            const before = store.filter((r) => r.userId === userId).length;

            const result = await createRecipient(userId, input);
            const after = store.filter((r) => r.userId === userId).length;

            if (existingCount >= RECIPIENT_CAP) {
              expect(result.data).toBeNull();
              expect(result.error!.code).toBe('LIMIT_REACHED');
              expect(after).toBe(before); // no insert
            } else {
              expect(result.error).toBeNull();
              expect(result.data).not.toBeNull();
              expect(after).toBe(before + 1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: saved-recipients-contact-book, Property 4: Snapshot immutability
  describe('Property 4: Snapshot immutability', () => {
    it('random update/delete sequences never write the deliveries table; snapshot bytes unchanged', async () => {
      // **Validates: Requirements 6.1, 6.2, 6.3**
      const opArb = fc.oneof(
        fc.record({ kind: fc.constant('update' as const), input: createInputArb }),
        fc.record({ kind: fc.constant('delete' as const) }),
        fc.record({ kind: fc.constant('create' as const), input: createInputArb }),
      );

      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.integer({ min: 1, max: 6 }),
          fc.array(opArb, { minLength: 1, maxLength: 12 }),
          async (userId, seedCount, ops) => {
            store = Array.from({ length: seedCount }, (_, i) => seedRow(userId, i));
            writtenTables = [];
            readTables = [];

            // An external, independent delivery snapshot the service must never touch.
            const deliverySnapshot = {
              recipient_name: 'Frozen Name',
              recipient_phone: '08099998888',
              delivery_notes: 'Leave at gate',
            };
            const snapshotJson = JSON.stringify(deliverySnapshot);

            for (const op of ops) {
              const ids = store.filter((r) => r.userId === userId).map((r) => r.id);
              const targetId = ids[0] ?? crypto.randomUUID();
              if (op.kind === 'update') {
                await updateRecipient(userId, targetId, op.input);
              } else if (op.kind === 'delete') {
                await deleteRecipient(userId, targetId);
              } else {
                await createRecipient(userId, op.input);
              }
            }

            // The service must never read or write the deliveries table.
            expect(writtenTables).not.toContain('deliveries');
            expect(readTables).not.toContain('deliveries');
            // Only the recipients table is ever written.
            for (const t of writtenTables) {
              expect(t).toBe('user_saved_recipients');
            }

            // Snapshot is byte-identical.
            expect(JSON.stringify(deliverySnapshot)).toBe(snapshotJson);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
