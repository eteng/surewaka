// Feature: admin-notifications
// Property 7: Unread Count Accuracy
// Property 4: Mark-All-Read Correctness
// Property 6: Mark-As-Read Idempotence
// Property 10: Broadcast to All Admins
// Property 12: Retention Cleanup Correctness
// Validates: Requirements 4.3, 2.7, 4.5, 3.3, 4.4, 5.4, 5.6, 8.1, 8.2

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { NOTIFICATION_TYPES } from '@surewaka/shared';

// ─── Mock State ──────────────────────────────────────────────────────────────

type MockNotification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  resourceLink: string | null;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let mockNotifications: MockNotification[] = [];
let mockAdminUsers: { userId: string }[] = [];
let insertedRecords: unknown[] = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  and: (...conditions: unknown[]) => ({ conditions, op: 'and' }),
  desc: (col: unknown) => ({ col, op: 'desc' }),
  count: () => ({ op: 'count' }),
  lt: (col: unknown, val: unknown) => ({ col, val, op: 'lt' }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    op: 'sql',
  }),
}));

vi.mock('@surewaka/db', () => {
  const notificationsTable = {
    id: 'id',
    userId: 'userId',
    type: 'type',
    title: 'title',
    message: 'message',
    resourceLink: 'resourceLink',
    isRead: 'isRead',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  };
  const userRolesTable = {
    userId: 'userId',
    role: 'role',
    isActive: 'isActive',
  };

  return {
    db: {
      select: (fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (...args: unknown[]) => {
            if (table === userRolesTable) {
              // Query for admin users (broadcast)
              return Promise.resolve(mockAdminUsers);
            }

            // Check if this is a count query
            if (fields && typeof fields === 'object' && 'total' in (fields as Record<string, unknown>)) {
              // Count query — count unread notifications
              const unreadCount = mockNotifications.filter((n) => !n.isRead).length;
              return Promise.resolve([{ total: unreadCount }]);
            }

            // Check if this is a "find by id" query (markAsRead lookup)
            // Return first matching notification or empty
            if (mockNotifications.length > 0) {
              return {
                limit: (n: number) =>
                  Promise.resolve(mockNotifications.slice(0, n).map((n) => ({
                    id: n.id,
                    userId: n.userId,
                  }))),
              };
            }

            return {
              limit: (n: number) => Promise.resolve([]),
            };
          },
          orderBy: (...args: unknown[]) => ({
            limit: (n: number) => ({
              offset: (o: number) => Promise.resolve(mockNotifications.slice(o, o + n)),
            }),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (data: unknown | unknown[]) => {
          const records = Array.isArray(data) ? data : [data];
          insertedRecords.push(...records);
          return {
            returning: (fields?: unknown) => Promise.resolve(records.map((r) => ({ id: crypto.randomUUID(), ...r }))),
          };
        },
      }),
      update: (table: unknown) => ({
        set: (data: unknown) => ({
          where: (...args: unknown[]) => {
            // For markAsRead — update single notification
            if ((data as Record<string, unknown>).isRead === true) {
              // For markAllAsRead — update all unread for user
              const unreadNotifications = mockNotifications.filter((n) => !n.isRead);
              unreadNotifications.forEach((n) => {
                n.isRead = true;
              });
              return {
                returning: (fields?: unknown) =>
                  Promise.resolve(unreadNotifications.map((n) => ({ id: n.id }))),
              };
            }
            return {
              returning: (fields?: unknown) => Promise.resolve([]),
            };
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: (...args: unknown[]) => {
          // For cleanup — the service passes a cutoff date via lt().
          // We extract it from the args. The service computes cutoff as now - 90 days.
          // The where arg is the result of lt(notifications.createdAt, cutoffDate)
          // which our mock returns as { col, val, op: 'lt' }
          let cutoffDate: Date;
          const ltArg = args[0] as { col?: unknown; val?: unknown; op?: string } | undefined;
          if (ltArg && ltArg.op === 'lt' && ltArg.val instanceof Date) {
            cutoffDate = ltArg.val;
          } else {
            // Fallback: compute our own cutoff
            cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 90);
          }
          const toDelete = mockNotifications.filter(
            (n) => n.createdAt < cutoffDate
          );
          const toKeep = mockNotifications.filter(
            (n) => n.createdAt >= cutoffDate
          );
          mockNotifications = toKeep;
          return {
            returning: (fields?: unknown) =>
              Promise.resolve(toDelete.map((n) => ({ id: n.id }))),
          };
        },
      }),
    },
    notifications: notificationsTable,
    userRoles: userRolesTable,
  };
});

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  createNotification,
  cleanupOldNotifications,
} from '../services/notification-service';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const uuidArb = fc.uuid();

const notificationTypeArb = fc.constantFrom(...NOTIFICATION_TYPES);

const safeStringArb = (min: number, max: number) =>
  fc.string({ minLength: min, maxLength: max }).filter((s) => s.trim().length >= min);

const notificationArb = (userId: string): fc.Arbitrary<MockNotification> =>
  fc.record({
    id: fc.uuid(),
    userId: fc.constant(userId),
    type: notificationTypeArb,
    title: safeStringArb(1, 200),
    message: safeStringArb(1, 500),
    resourceLink: fc.option(
      fc.string({ minLength: 2, maxLength: 50 }).map((s) => `/${s}`),
      { nil: null }
    ),
    isRead: fc.boolean(),
    createdAt: fc.date({
      min: new Date('2024-01-01'),
      max: new Date('2025-12-31'),
    }),
    updatedAt: fc.date({
      min: new Date('2024-01-01'),
      max: new Date('2025-12-31'),
    }),
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Notification Service — Property Tests', () => {
  beforeEach(() => {
    mockNotifications = [];
    mockAdminUsers = [];
    insertedRecords = [];
  });

  describe('Property 7: Unread Count Accuracy', () => {
    it('getUnreadCount returns exactly the count of notifications where is_read = false', async () => {
      // **Validates: Requirements 4.3**
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }),
          async (userId, isReadValues) => {
            // Set up mock notifications with the given is_read values
            mockNotifications = isReadValues.map((isRead, i) => ({
              id: crypto.randomUUID(),
              userId,
              type: 'new_user_signup',
              title: `Notification ${i}`,
              message: `Message ${i}`,
              resourceLink: null,
              isRead,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            const result = await getUnreadCount(userId);

            const expectedUnread = isReadValues.filter((r) => r === false).length;
            expect(result.data).not.toBeNull();
            expect(result.data!.count).toBe(expectedUnread);
            expect(result.error).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('getUnreadCount returns 0 when all notifications are read', async () => {
      // **Validates: Requirements 4.3**
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.integer({ min: 0, max: 20 }),
          async (userId, count) => {
            // All notifications are read
            mockNotifications = Array.from({ length: count }, (_, i) => ({
              id: crypto.randomUUID(),
              userId,
              type: 'delivery_issue' as const,
              title: `Notification ${i}`,
              message: `Message ${i}`,
              resourceLink: null,
              isRead: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            const result = await getUnreadCount(userId);

            expect(result.data!.count).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Mark-All-Read Correctness', () => {
    it('after markAllAsRead, every notification has is_read = true and unread count = 0', async () => {
      // **Validates: Requirements 2.7, 4.5**
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
          async (userId, isReadValues) => {
            // Set up mock notifications with mixed read/unread
            mockNotifications = isReadValues.map((isRead, i) => ({
              id: crypto.randomUUID(),
              userId,
              type: 'new_user_signup',
              title: `Notification ${i}`,
              message: `Message ${i}`,
              resourceLink: null,
              isRead,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            const unreadBefore = mockNotifications.filter((n) => !n.isRead).length;

            const result = await markAllAsRead(userId);

            // Service should report the number of updated notifications
            expect(result.data).not.toBeNull();
            expect(result.data!.updated).toBe(unreadBefore);
            expect(result.error).toBeNull();

            // After markAllAsRead, all notifications should be read
            const allRead = mockNotifications.every((n) => n.isRead === true);
            expect(allRead).toBe(true);

            // Unread count should be 0
            const unreadAfter = mockNotifications.filter((n) => !n.isRead).length;
            expect(unreadAfter).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('markAllAsRead returns updated: 0 when all are already read', async () => {
      // **Validates: Requirements 2.7, 4.5**
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.integer({ min: 1, max: 20 }),
          async (userId, count) => {
            // All notifications already read
            mockNotifications = Array.from({ length: count }, (_, i) => ({
              id: crypto.randomUUID(),
              userId,
              type: 'system_alert' as const,
              title: `Notification ${i}`,
              message: `Message ${i}`,
              resourceLink: null,
              isRead: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            const result = await markAllAsRead(userId);

            expect(result.data!.updated).toBe(0);
            expect(result.error).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: Mark-As-Read Idempotence', () => {
    it('calling markAsRead on an already-read notification succeeds without error', async () => {
      // **Validates: Requirements 3.3, 4.4**
      await fc.assert(
        fc.asyncProperty(uuidArb, uuidArb, async (userId, notificationId) => {
          // Set up a notification that is already read
          mockNotifications = [
            {
              id: notificationId,
              userId,
              type: 'new_user_signup',
              title: 'Already read notification',
              message: 'This was already read',
              resourceLink: null,
              isRead: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];

          const result = await markAsRead(userId, notificationId);

          // Should succeed without error (idempotent)
          expect(result.error).toBeNull();
          expect(result.data).not.toBeNull();
          expect(result.data!.id).toBe(notificationId);
          expect(result.data!.isRead).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('calling markAsRead twice on the same notification succeeds both times', async () => {
      // **Validates: Requirements 3.3, 4.4**
      await fc.assert(
        fc.asyncProperty(uuidArb, uuidArb, async (userId, notificationId) => {
          // Set up an unread notification
          mockNotifications = [
            {
              id: notificationId,
              userId,
              type: 'delivery_issue',
              title: 'Unread notification',
              message: 'First time reading',
              resourceLink: null,
              isRead: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];

          // First call
          const result1 = await markAsRead(userId, notificationId);
          expect(result1.error).toBeNull();
          expect(result1.data!.isRead).toBe(true);

          // Second call (now already read)
          const result2 = await markAsRead(userId, notificationId);
          expect(result2.error).toBeNull();
          expect(result2.data!.isRead).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Broadcast to All Admins', () => {
    it('creating with userId "all_admins" produces exactly N records for N admin users', async () => {
      // **Validates: Requirements 5.4, 5.6**
      await fc.assert(
        fc.asyncProperty(
          fc.array(uuidArb, { minLength: 1, maxLength: 20 }),
          notificationTypeArb,
          safeStringArb(1, 100),
          safeStringArb(1, 200),
          fc.option(
            fc.string({ minLength: 2, maxLength: 30 }).map((s) => `/${s.replace(/[^a-z0-9]/gi, 'x')}`),
            { nil: undefined }
          ),
          async (adminUserIds, type, title, message, resourceLink) => {
            // Set up mock admin users
            mockAdminUsers = adminUserIds.map((id) => ({ userId: id }));
            insertedRecords = [];

            const input = {
              userId: 'all_admins' as const,
              type,
              title,
              message,
              ...(resourceLink ? { resourceLink } : {}),
            };

            const result = await createNotification(input);

            // Should create exactly N records
            expect(result.data).not.toBeNull();
            expect(result.data!.created).toBe(adminUserIds.length);
            expect(result.error).toBeNull();

            // Verify each inserted record has identical type, title, message, resourceLink
            expect(insertedRecords.length).toBe(adminUserIds.length);
            for (const record of insertedRecords as Record<string, unknown>[]) {
              expect(record.type).toBe(type);
              expect(record.title).toBe(title);
              expect(record.message).toBe(message);
              expect(record.resourceLink).toBe(resourceLink ?? null);
            }

            // Verify each admin user got a notification
            const insertedUserIds = (insertedRecords as Record<string, unknown>[]).map(
              (r) => r.userId
            );
            for (const adminId of adminUserIds) {
              expect(insertedUserIds).toContain(adminId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('broadcast with 0 admin users creates 0 records', async () => {
      // **Validates: Requirements 5.4, 5.6**
      await fc.assert(
        fc.asyncProperty(
          notificationTypeArb,
          safeStringArb(1, 100),
          safeStringArb(1, 200),
          async (type, title, message) => {
            mockAdminUsers = [];
            insertedRecords = [];

            const result = await createNotification({
              userId: 'all_admins',
              type,
              title,
              message,
            });

            expect(result.data).not.toBeNull();
            expect(result.data!.created).toBe(0);
            expect(insertedRecords.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 12: Retention Cleanup Correctness', () => {
    it('cleanup deletes all notifications older than 90 days and preserves newer ones', async () => {
      // **Validates: Requirements 8.1, 8.2**
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.uuid(),
              userId: fc.uuid(),
              daysAgo: fc.integer({ min: 0, max: 365 }),
            }),
            { minLength: 1, maxLength: 30 }
          ),
          async (notificationSpecs) => {
            const now = new Date();

            // Set up mock notifications with varying ages
            mockNotifications = notificationSpecs.map((spec) => {
              const createdAt = new Date(now);
              createdAt.setDate(createdAt.getDate() - spec.daysAgo);
              return {
                id: spec.id,
                userId: spec.userId,
                type: 'system_alert' as const,
                title: 'Test notification',
                message: 'Test message',
                resourceLink: null,
                isRead: false,
                createdAt,
                updatedAt: createdAt,
              };
            });

            const expectedDeleted = notificationSpecs.filter((s) => s.daysAgo > 90).length;
            const expectedPreserved = notificationSpecs.filter((s) => s.daysAgo <= 90).length;

            const result = await cleanupOldNotifications();

            // Should delete exactly the old notifications
            expect(result.deleted).toBe(expectedDeleted);

            // Remaining notifications should all be 90 days old or newer
            expect(mockNotifications.length).toBe(expectedPreserved);

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 90);
            for (const n of mockNotifications) {
              expect(n.createdAt.getTime()).toBeGreaterThanOrEqual(cutoffDate.getTime());
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('cleanup preserves notifications that are 89 days old (within retention window)', async () => {
      // **Validates: Requirements 8.1, 8.2**
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 89 }),
          async (ids, daysAgo) => {
            const now = new Date();
            const withinRetention = new Date(now);
            withinRetention.setDate(withinRetention.getDate() - daysAgo);

            // All notifications are within the 90-day retention window
            mockNotifications = ids.map((id) => ({
              id,
              userId: crypto.randomUUID(),
              type: 'new_user_signup' as const,
              title: 'Recent notification',
              message: 'Within retention window',
              resourceLink: null,
              isRead: false,
              createdAt: withinRetention,
              updatedAt: withinRetention,
            }));

            const result = await cleanupOldNotifications();

            // None should be deleted (all within 90-day retention)
            expect(result.deleted).toBe(0);
            expect(mockNotifications.length).toBe(ids.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('cleanup deletes notifications that are 91+ days old', async () => {
      // **Validates: Requirements 8.1, 8.2**
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.uuid(),
              daysAgo: fc.integer({ min: 91, max: 365 }),
            }),
            { minLength: 1, maxLength: 15 }
          ),
          async (specs) => {
            const now = new Date();

            mockNotifications = specs.map((spec) => {
              const createdAt = new Date(now);
              createdAt.setDate(createdAt.getDate() - spec.daysAgo);
              return {
                id: spec.id,
                userId: crypto.randomUUID(),
                type: 'dispute_opened' as const,
                title: 'Old notification',
                message: 'Should be deleted',
                resourceLink: null,
                isRead: true,
                createdAt,
                updatedAt: createdAt,
              };
            });

            const result = await cleanupOldNotifications();

            // All should be deleted
            expect(result.deleted).toBe(specs.length);
            expect(mockNotifications.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
