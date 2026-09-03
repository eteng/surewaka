// Feature: saved-recipients-contact-book — recipient-service unit tests
// Validates: Requirements 4.3, 4.4, 5.1

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Captured calls / state ──────────────────────────────────────────────────

type Cond =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'and'; conditions: Cond[] }
  | { op: 'asc'; col: string }
  | { op: 'count' };

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

let store: RecipientRow[] = [];
/** Records the WHERE condition passed to the count select. */
let lastCountWhere: Cond | undefined;
/** Records the `set(...)` payload passed to update. */
let lastUpdateSet: Record<string, unknown> | undefined;

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
  };

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (_table: unknown) => {
        const isCount = !!fields && 'total' in fields;
        let whereCond: Cond | undefined;
        const resolveRows = () => {
          const filtered = store.filter((r) => matches(r, whereCond));
          return isCount ? [{ total: filtered.length }] : filtered;
        };
        const query: Record<string, unknown> = {
          where: (cond: Cond) => {
            whereCond = cond;
            if (isCount) lastCountWhere = cond;
            return query;
          },
          orderBy: () =>
            Promise.resolve(
              store
                .filter((r) => matches(r, whereCond))
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
            ),
          limit: (n: number) => Promise.resolve(resolveRows().slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(resolveRows()).then(resolve, reject),
        };
        return query;
      },
    }),
    insert: (_table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
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
    update: (_table: unknown) => ({
      set: (data: Record<string, unknown>) => {
        lastUpdateSet = data;
        return {
          where: (cond: Cond) => ({
            returning: () => {
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
        };
      },
    }),
    delete: (_table: unknown) => ({
      where: (cond: Cond) => ({
        returning: () => {
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

import {
  listRecipients,
  getRecipient,
  createRecipient,
  updateRecipient,
  deleteRecipient,
} from '../recipient-service';

function makeRow(userId: string, over: Partial<RecipientRow> = {}): RecipientRow {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    userId,
    label: null,
    recipientName: 'Ada Lovelace',
    recipientPhone: '08012345678',
    deliveryNotes: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const OWNER = 'owner-user-id';
const OTHER = 'other-user-id';

describe('recipient-service — unit tests', () => {
  beforeEach(() => {
    store = [];
    lastCountWhere = undefined;
    lastUpdateSet = undefined;
  });

  describe('cross-owner access returns NOT_FOUND (Req 4.3, 4.4)', () => {
    it('getRecipient on another owner\'s recipient => NOT_FOUND', async () => {
      const row = makeRow(OTHER);
      store = [row];

      const result = await getRecipient(OWNER, row.id);

      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: 'NOT_FOUND', message: 'Recipient not found' });
    });

    it('getRecipient on own recipient succeeds', async () => {
      const row = makeRow(OWNER, { recipientName: 'Grace Hopper' });
      store = [row];

      const result = await getRecipient(OWNER, row.id);

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ id: row.id, recipientName: 'Grace Hopper' });
    });

    it('updateRecipient on another owner\'s recipient => NOT_FOUND and leaves it unchanged', async () => {
      const row = makeRow(OTHER, { recipientName: 'Original' });
      store = [row];

      const result = await updateRecipient(OWNER, row.id, { recipientName: 'Hacked' });

      expect(result.data).toBeNull();
      expect(result.error!.code).toBe('NOT_FOUND');
      expect(store.find((r) => r.id === row.id)!.recipientName).toBe('Original');
    });

    it('deleteRecipient on another owner\'s recipient => NOT_FOUND and does not delete it', async () => {
      const row = makeRow(OTHER);
      store = [row];

      const result = await deleteRecipient(OWNER, row.id);

      expect(result.data).toBeNull();
      expect(result.error!.code).toBe('NOT_FOUND');
      expect(store.some((r) => r.id === row.id)).toBe(true);
    });

    it('deleteRecipient on own recipient succeeds and removes the row', async () => {
      const row = makeRow(OWNER);
      store = [row];

      const result = await deleteRecipient(OWNER, row.id);

      expect(result.error).toBeNull();
      expect(result.data).toBeNull();
      expect(store.some((r) => r.id === row.id)).toBe(false);
    });

    it('listRecipients returns only the owner\'s rows', async () => {
      store = [makeRow(OWNER), makeRow(OTHER), makeRow(OWNER)];

      const result = await listRecipients(OWNER);

      expect(result.error).toBeNull();
      expect(result.data!.length).toBe(2);
    });
  });

  describe('cap behavior (Req 5.1)', () => {
    it('RECIPIENT_CAP is 25: create is rejected with LIMIT_REACHED at exactly 25 existing', async () => {
      store = Array.from({ length: 25 }, () => makeRow(OWNER));

      const result = await createRecipient(OWNER, {
        recipientName: 'New Person',
        recipientPhone: '08012345678',
      });

      expect(result.data).toBeNull();
      expect(result.error!.code).toBe('LIMIT_REACHED');
      // No insert happened — still 25.
      expect(store.filter((r) => r.userId === OWNER).length).toBe(25);
    });

    it('create succeeds at 24 existing (one below the cap)', async () => {
      store = Array.from({ length: 24 }, () => makeRow(OWNER));

      const result = await createRecipient(OWNER, {
        recipientName: 'New Person',
        recipientPhone: '08012345678',
      });

      expect(result.error).toBeNull();
      expect(result.data).not.toBeNull();
      expect(store.filter((r) => r.userId === OWNER).length).toBe(25);
    });

    it('cap is scoped per-owner: another user having 25 does not block this owner', async () => {
      store = Array.from({ length: 25 }, () => makeRow(OTHER));

      const result = await createRecipient(OWNER, {
        recipientName: 'New Person',
        recipientPhone: '08012345678',
      });

      expect(result.error).toBeNull();
      expect(result.data).not.toBeNull();
    });
  });

  describe('count query carries WHERE user_id (Req 4.3)', () => {
    it('createRecipient count check filters by the session user id', async () => {
      store = [makeRow(OWNER)];

      await createRecipient(OWNER, {
        recipientName: 'Person',
        recipientPhone: '08012345678',
      });

      // The count select's WHERE must bind userId = session user.
      const preds = eqPredicates(lastCountWhere);
      expect(preds).toContainEqual({ col: 'userId', val: OWNER });
    });
  });

  describe('updatedAt is set on update', () => {
    it('updateRecipient always sets updatedAt to a Date', async () => {
      const row = makeRow(OWNER, { recipientName: 'Before' });
      store = [row];

      const result = await updateRecipient(OWNER, row.id, { recipientName: 'After' });

      expect(result.error).toBeNull();
      expect(result.data!.recipientName).toBe('After');
      expect(lastUpdateSet).toBeDefined();
      expect(lastUpdateSet!.updatedAt).toBeInstanceOf(Date);
    });

    it('updateRecipient only sets provided fields plus updatedAt', async () => {
      const row = makeRow(OWNER, { recipientName: 'Keep', recipientPhone: '08011112222' });
      store = [row];

      await updateRecipient(OWNER, row.id, { label: 'Home' });

      expect(lastUpdateSet).toMatchObject({ label: 'Home' });
      expect(lastUpdateSet!.updatedAt).toBeInstanceOf(Date);
      // recipientName / recipientPhone were not part of the input, so not in the set payload.
      expect('recipientName' in (lastUpdateSet as object)).toBe(false);
      expect('recipientPhone' in (lastUpdateSet as object)).toBe(false);
    });
  });

  describe('create maps null-able fields and returns SavedRecipient shape', () => {
    it('label/deliveryNotes omitted => undefined in returned shape', async () => {
      const result = await createRecipient(OWNER, {
        recipientName: 'No Extras',
        recipientPhone: '08012345678',
      });

      expect(result.error).toBeNull();
      expect(result.data!.label).toBeUndefined();
      expect(result.data!.deliveryNotes).toBeUndefined();
      expect(typeof result.data!.created_at).toBe('string');
    });
  });
});
