// Feature: admin-notifications
// Property 9: Notification Creation Validation
// Property 8: Response Shape Invariant
// Validates: Requirements 5.3, 5.5, 4.7

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  createNotificationSchema,
  NOTIFICATION_TYPES,
} from '@surewaka/shared';

// ─── Property 9: Notification Creation Validation ────────────────────────────
// For any input payload, the create notification endpoint SHALL accept the
// payload if and only if it passes the Zod schema validation (valid UUID or
// "all_admins" for userId, valid enum for type, title 1-200 chars, message
// 1-500 chars, optional relative URL for resourceLink). Invalid payloads SHALL
// receive HTTP 400 with error code VALIDATION_ERROR.

describe('Property 9: Notification Creation Validation', () => {
  // ─── Arbitraries ─────────────────────────────────────────────────────────

  const validUuidArb = fc.uuid();

  const validUserIdArb = fc.oneof(
    validUuidArb,
    fc.constant('all_admins')
  );

  const validTypeArb = fc.constantFrom(...NOTIFICATION_TYPES);

  const validTitleArb = fc.string({ minLength: 1, maxLength: 200 }).filter(
    (s) => s.length >= 1 && s.length <= 200
  );

  const validMessageArb = fc.string({ minLength: 1, maxLength: 500 }).filter(
    (s) => s.length >= 1 && s.length <= 500
  );

  const validResourceLinkArb = fc.oneof(
    fc.constant(undefined),
    fc.string({ minLength: 1, maxLength: 498 }).map((s) => `/${s.replace(/\n/g, 'x')}`)
  );

  const validPayloadArb = fc.record({
    userId: validUserIdArb,
    type: validTypeArb,
    title: validTitleArb,
    message: validMessageArb,
    resourceLink: validResourceLinkArb,
  });

  // ─── Valid Payload Tests ─────────────────────────────────────────────────

  it('valid payloads are accepted by the schema', () => {
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(validPayloadArb, (payload) => {
        const result = createNotificationSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('valid payloads with UUID userId are accepted', () => {
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(
        validUuidArb,
        validTypeArb,
        validTitleArb,
        validMessageArb,
        (userId, type, title, message) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
          });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid payloads with "all_admins" userId are accepted', () => {
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(
        validTypeArb,
        validTitleArb,
        validMessageArb,
        (type, title, message) => {
          const result = createNotificationSchema.safeParse({
            userId: 'all_admins',
            type,
            title,
            message,
          });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Invalid userId Tests ────────────────────────────────────────────────

  it('invalid userId (not UUID and not "all_admins") is rejected', () => {
    // **Validates: Requirements 5.5**
    const badUserIdArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
      (s) => {
        // Not a valid UUID v4 pattern and not "all_admins"
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return !uuidRegex.test(s) && s !== 'all_admins';
      }
    );

    fc.assert(
      fc.property(
        badUserIdArb,
        validTypeArb,
        validTitleArb,
        validMessageArb,
        (userId, type, title, message) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Invalid type Tests ──────────────────────────────────────────────────

  it('invalid notification type is rejected', () => {
    // **Validates: Requirements 5.5**
    const invalidTypeArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
      (s) => !(NOTIFICATION_TYPES as readonly string[]).includes(s)
    );

    fc.assert(
      fc.property(
        validUserIdArb,
        invalidTypeArb,
        validTitleArb,
        validMessageArb,
        (userId, type, title, message) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Invalid title Tests ─────────────────────────────────────────────────

  it('title exceeding 200 characters is rejected', () => {
    // **Validates: Requirements 5.5**
    const longTitleArb = fc.string({ minLength: 201, maxLength: 500 });

    fc.assert(
      fc.property(
        validUserIdArb,
        validTypeArb,
        longTitleArb,
        validMessageArb,
        (userId, type, title, message) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty title is rejected', () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(
        validUserIdArb,
        validTypeArb,
        validMessageArb,
        (userId, type, message) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title: '',
            message,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Invalid message Tests ───────────────────────────────────────────────

  it('message exceeding 500 characters is rejected', () => {
    // **Validates: Requirements 5.5**
    const longMessageArb = fc.string({ minLength: 501, maxLength: 1000 });

    fc.assert(
      fc.property(
        validUserIdArb,
        validTypeArb,
        validTitleArb,
        longMessageArb,
        (userId, type, title, message) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty message is rejected', () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(
        validUserIdArb,
        validTypeArb,
        validTitleArb,
        (userId, type, title) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message: '',
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Invalid resourceLink Tests ──────────────────────────────────────────

  it('non-relative URL (not starting with "/") is rejected', () => {
    // **Validates: Requirements 5.5**
    const nonRelativeUrlArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.startsWith('/')),
      fc.webUrl(),
      fc.constant('http://example.com/path'),
      fc.constant('https://example.com'),
      fc.constant('example.com/path')
    );

    fc.assert(
      fc.property(
        validUserIdArb,
        validTypeArb,
        validTitleArb,
        validMessageArb,
        nonRelativeUrlArb,
        (userId, type, title, message, resourceLink) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
            resourceLink,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid relative URL (starting with "/") is accepted', () => {
    // **Validates: Requirements 5.3**
    const relativeUrlArb = fc.string({ minLength: 1, maxLength: 498 }).map(
      (s) => `/${s.replace(/\n/g, 'x')}`
    );

    fc.assert(
      fc.property(
        validUserIdArb,
        validTypeArb,
        validTitleArb,
        validMessageArb,
        relativeUrlArb,
        (userId, type, title, message, resourceLink) => {
          const result = createNotificationSchema.safeParse({
            userId,
            type,
            title,
            message,
            resourceLink,
          });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 8: Response Shape Invariant ────────────────────────────────────
// For any request to any notification endpoint (valid or invalid), the response
// body SHALL conform to the shape { data, error, meta } where exactly one of
// data or error is non-null for success/failure cases respectively.

// We test this by calling the service functions directly with various inputs
// and verifying the response shape invariant holds.

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
              return Promise.resolve(mockAdminUsers);
            }

            if (
              fields &&
              typeof fields === 'object' &&
              'total' in (fields as Record<string, unknown>)
            ) {
              const unreadCount = mockNotifications.filter((n) => !n.isRead).length;
              return Promise.resolve([{ total: unreadCount }]);
            }

            // Support chaining: where().orderBy().limit().offset() for getNotifications
            const chainable = {
              orderBy: (...orderArgs: unknown[]) => ({
                limit: (n: number) => ({
                  offset: (o: number) => Promise.resolve(mockNotifications.slice(o, o + n)),
                }),
              }),
              limit: (n: number) =>
                Promise.resolve(
                  mockNotifications.length > 0
                    ? mockNotifications.slice(0, n).map((n) => ({
                        id: n.id,
                        userId: n.userId,
                      }))
                    : []
                ),
            };

            return chainable;
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
          return {
            returning: (fields?: unknown) =>
              Promise.resolve(records.map((r) => ({ id: crypto.randomUUID(), ...r }))),
          };
        },
      }),
      update: (table: unknown) => ({
        set: (data: unknown) => ({
          where: (...args: unknown[]) => {
            if ((data as Record<string, unknown>).isRead === true) {
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
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - 90);
          const toDelete = mockNotifications.filter((n) => n.createdAt < cutoffDate);
          mockNotifications = mockNotifications.filter((n) => n.createdAt >= cutoffDate);
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
  getNotifications,
  getUnreadCount,
  createNotification,
  markAsRead,
  markAllAsRead,
} from '../services/notification-service';

describe('Property 8: Response Shape Invariant', () => {
  beforeEach(() => {
    mockNotifications = [];
    mockAdminUsers = [];
  });

  // ─── Arbitraries ─────────────────────────────────────────────────────────

  const validUuidArb = fc.uuid();
  const validTypeArb = fc.constantFrom(...NOTIFICATION_TYPES);
  const validTitleArb = fc.string({ minLength: 1, maxLength: 200 }).filter(
    (s) => s.length >= 1
  );
  const validMessageArb = fc.string({ minLength: 1, maxLength: 500 }).filter(
    (s) => s.length >= 1
  );

  /**
   * Helper: asserts the response conforms to { data, error, meta } shape
   * where exactly one of data/error is non-null.
   */
  function assertResponseShape(result: unknown): void {
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();

    const response = result as Record<string, unknown>;

    // Must have data and error keys
    expect('data' in response).toBe(true);
    expect('error' in response).toBe(true);

    // Exactly one of data/error is non-null
    if (response.data !== null) {
      expect(response.error).toBeNull();
    } else {
      expect(response.error).not.toBeNull();
      // Error must have code and message
      const error = response.error as Record<string, unknown>;
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
    }
  }

  // ─── getUnreadCount response shape ───────────────────────────────────────

  it('getUnreadCount always returns { data, error, meta } shape', async () => {
    // **Validates: Requirements 4.7**
    await fc.assert(
      fc.asyncProperty(validUuidArb, async (userId) => {
        // Set up some random notifications
        mockNotifications = Array.from(
          { length: Math.floor(Math.random() * 10) },
          (_, i) => ({
            id: crypto.randomUUID(),
            userId,
            type: 'system_alert',
            title: `Notification ${i}`,
            message: `Message ${i}`,
            resourceLink: null,
            isRead: Math.random() > 0.5,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        );

        const result = await getUnreadCount(userId);
        assertResponseShape(result);
      }),
      { numRuns: 100 }
    );
  });

  // ─── createNotification response shape (valid input) ─────────────────────

  it('createNotification with valid input returns { data, error, meta } shape with data non-null', async () => {
    // **Validates: Requirements 4.7**
    await fc.assert(
      fc.asyncProperty(
        validUuidArb,
        validTypeArb,
        validTitleArb,
        validMessageArb,
        async (userId, type, title, message) => {
          mockAdminUsers = [];

          const result = await createNotification({
            userId,
            type,
            title,
            message,
          });

          assertResponseShape(result);
          expect(result.data).not.toBeNull();
          expect(result.error).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── createNotification response shape (invalid input) ───────────────────

  it('createNotification with invalid input returns { data, error, meta } shape with error non-null', async () => {
    // **Validates: Requirements 4.7**
    const invalidPayloadArb = fc.oneof(
      // Bad userId
      fc.record({
        userId: fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            return !uuidRegex.test(s) && s !== 'all_admins';
          }
        ),
        type: validTypeArb,
        title: validTitleArb,
        message: validMessageArb,
      }),
      // Bad type
      fc.record({
        userId: fc.oneof(fc.uuid(), fc.constant('all_admins')),
        type: fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => !(NOTIFICATION_TYPES as readonly string[]).includes(s)
        ),
        title: validTitleArb,
        message: validMessageArb,
      }),
      // Title too long
      fc.record({
        userId: fc.oneof(fc.uuid(), fc.constant('all_admins')),
        type: validTypeArb,
        title: fc.string({ minLength: 201, maxLength: 500 }),
        message: validMessageArb,
      }),
      // Empty title
      fc.record({
        userId: fc.oneof(fc.uuid(), fc.constant('all_admins')),
        type: validTypeArb,
        title: fc.constant(''),
        message: validMessageArb,
      }),
      // Message too long
      fc.record({
        userId: fc.oneof(fc.uuid(), fc.constant('all_admins')),
        type: validTypeArb,
        title: validTitleArb,
        message: fc.string({ minLength: 501, maxLength: 1000 }),
      }),
      // Non-relative resourceLink
      fc.record({
        userId: fc.oneof(fc.uuid(), fc.constant('all_admins')),
        type: validTypeArb,
        title: validTitleArb,
        message: validMessageArb,
        resourceLink: fc.string({ minLength: 1, maxLength: 200 }).filter(
          (s) => !s.startsWith('/')
        ),
      })
    );

    await fc.assert(
      fc.asyncProperty(invalidPayloadArb, async (payload) => {
        const result = await createNotification(payload as any);

        assertResponseShape(result);
        expect(result.data).toBeNull();
        expect(result.error).not.toBeNull();
        expect(result.error!.code).toBe('VALIDATION_ERROR');
      }),
      { numRuns: 100 }
    );
  });

  // ─── markAsRead response shape ───────────────────────────────────────────

  it('markAsRead always returns { data, error, meta } shape regardless of notification existence', async () => {
    // **Validates: Requirements 4.7**
    await fc.assert(
      fc.asyncProperty(
        validUuidArb,
        validUuidArb,
        fc.boolean(),
        async (userId, notificationId, exists) => {
          if (exists) {
            mockNotifications = [
              {
                id: notificationId,
                userId,
                type: 'new_user_signup',
                title: 'Test',
                message: 'Test message',
                resourceLink: null,
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ];
          } else {
            mockNotifications = [];
          }

          const result = await markAsRead(userId, notificationId);
          assertResponseShape(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── markAllAsRead response shape ────────────────────────────────────────

  it('markAllAsRead always returns { data, error, meta } shape', async () => {
    // **Validates: Requirements 4.7**
    await fc.assert(
      fc.asyncProperty(
        validUuidArb,
        fc.array(fc.boolean(), { minLength: 0, maxLength: 20 }),
        async (userId, isReadValues) => {
          mockNotifications = isReadValues.map((isRead, i) => ({
            id: crypto.randomUUID(),
            userId,
            type: 'delivery_issue',
            title: `Notification ${i}`,
            message: `Message ${i}`,
            resourceLink: null,
            isRead,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));

          const result = await markAllAsRead(userId);
          assertResponseShape(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── getNotifications response shape ─────────────────────────────────────

  it('getNotifications always returns { data, error, meta } shape with pagination meta', async () => {
    // **Validates: Requirements 4.7**
    await fc.assert(
      fc.asyncProperty(
        validUuidArb,
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 50 }),
        async (userId, page, pageSize) => {
          mockNotifications = Array.from(
            { length: Math.floor(Math.random() * 15) },
            (_, i) => ({
              id: crypto.randomUUID(),
              userId,
              type: 'system_alert' as const,
              title: `Notification ${i}`,
              message: `Message ${i}`,
              resourceLink: null,
              isRead: Math.random() > 0.5,
              createdAt: new Date(Date.now() - i * 60000),
              updatedAt: new Date(),
            })
          );

          const result = await getNotifications(userId, { page, pageSize });
          assertResponseShape(result);

          // Meta should contain pagination info
          expect(result.meta).toBeDefined();
          if (result.meta) {
            expect(typeof result.meta.page).toBe('number');
            expect(typeof result.meta.pageSize).toBe('number');
            expect(typeof result.meta.total).toBe('number');
            expect(typeof result.meta.totalPages).toBe('number');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
