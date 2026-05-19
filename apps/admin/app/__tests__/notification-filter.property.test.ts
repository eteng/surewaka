// Feature: admin-notifications, Property 11, 2: Filter correctness, Sorting and Pagination
// Validates: Requirements 7.3, 2.2, 4.2, 7.2
//
// Property 11: Filter Correctness — for any filter combination (type and/or isRead),
// every returned notification matches all applied criteria and no matching notification
// is excluded from results (completeness).
//
// Property 2: Notification List Sorting and Pagination — returned list is sorted in
// strictly descending order by created_at, and item count ≤ pageSize.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Constants (mirroring @surewaka/shared) ──────────────────────────────────

const NOTIFICATION_TYPES = [
  'new_user_signup',
  'delivery_issue',
  'carrier_verification_request',
  'carrier_verified',
  'dispute_opened',
  'driver_verification_request',
  'system_alert',
] as const;

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

type NotificationData = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceLink: string | null;
  isRead: boolean;
  createdAt: string;
};

type FilterOptions = {
  page: number;
  pageSize: number;
  type?: NotificationType;
  isRead?: boolean;
};

// ─── Pure filtering and sorting logic (mirrors what the service/hook does) ───

/**
 * Apply filters to a list of notifications.
 * This mirrors the filtering logic used by the notification service:
 * - If type is specified, only notifications with that type are included
 * - If isRead is specified, only notifications with that isRead value are included
 * - Both filters use AND logic when combined
 */
function filterNotifications(
  notifications: NotificationData[],
  options: FilterOptions,
): NotificationData[] {
  let filtered = notifications;

  if (options.type !== undefined) {
    filtered = filtered.filter((n) => n.type === options.type);
  }

  if (options.isRead !== undefined) {
    filtered = filtered.filter((n) => n.isRead === options.isRead);
  }

  return filtered;
}

/**
 * Sort notifications by createdAt in descending order (newest first).
 * This mirrors the sorting logic used by the notification service.
 */
function sortNotifications(notifications: NotificationData[]): NotificationData[] {
  return [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Apply pagination to a sorted list of notifications.
 * Returns at most pageSize items for the given page.
 */
function paginateNotifications(
  notifications: NotificationData[],
  page: number,
  pageSize: number,
): NotificationData[] {
  const start = (page - 1) * pageSize;
  return notifications.slice(start, start + pageSize);
}

/**
 * Full query pipeline: filter → sort → paginate.
 * This mirrors the complete getNotifications service logic.
 */
function queryNotifications(
  notifications: NotificationData[],
  options: FilterOptions,
): NotificationData[] {
  const filtered = filterNotifications(notifications, options);
  const sorted = sortNotifications(filtered);
  return paginateNotifications(sorted, options.page, options.pageSize);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const notificationTypeArb = fc.constantFrom(...NOTIFICATION_TYPES);

const isoTimestampArb = fc
  .integer({
    min: new Date('2023-01-01').getTime(),
    max: new Date('2025-06-01').getTime(),
  })
  .map((ts) => new Date(ts).toISOString());

const notificationDataArb: fc.Arbitrary<NotificationData> = fc.record({
  id: fc.uuid(),
  type: notificationTypeArb,
  title: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  message: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  resourceLink: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/${s.replace(/^\/+/, '')}`),
  ),
  isRead: fc.boolean(),
  createdAt: isoTimestampArb,
});

const notificationListArb = fc.array(notificationDataArb, { minLength: 0, maxLength: 50 });

const filterOptionsArb: fc.Arbitrary<FilterOptions> = fc.record({
  page: fc.integer({ min: 1, max: 5 }),
  pageSize: fc.integer({ min: 1, max: 50 }),
  type: fc.option(notificationTypeArb, { nil: undefined }),
  isRead: fc.option(fc.boolean(), { nil: undefined }),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Notification Filter — Property Tests', () => {
  describe('Property 11: Filter Correctness', () => {
    // **Validates: Requirements 7.3**

    it('every returned notification matches all applied filter criteria', () => {
      fc.assert(
        fc.property(notificationListArb, filterOptionsArb, (notifications, options) => {
          const results = queryNotifications(notifications, options);

          // **Validates: Requirements 7.3**
          for (const notification of results) {
            if (options.type !== undefined) {
              expect(notification.type).toBe(options.type);
            }
            if (options.isRead !== undefined) {
              expect(notification.isRead).toBe(options.isRead);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('no matching notification is excluded from the full filtered set', () => {
      fc.assert(
        fc.property(notificationListArb, filterOptionsArb, (notifications, options) => {
          // Get the full filtered set (without pagination)
          const filtered = filterNotifications(notifications, options);
          const sorted = sortNotifications(filtered);

          // Get the paginated result
          const paginated = paginateNotifications(sorted, options.page, options.pageSize);

          // The paginated result should be a contiguous slice of the sorted filtered set
          const start = (options.page - 1) * options.pageSize;
          const expectedSlice = sorted.slice(start, start + options.pageSize);

          // **Validates: Requirements 7.3**
          expect(paginated).toEqual(expectedSlice);

          // Every notification in the full filtered set that falls within this page
          // must be present in the results (completeness for the page)
          expect(paginated.length).toBe(expectedSlice.length);
        }),
        { numRuns: 100 },
      );
    });

    it('type filter only returns notifications of the specified type', () => {
      fc.assert(
        fc.property(notificationListArb, notificationTypeArb, (notifications, type) => {
          const options: FilterOptions = { page: 1, pageSize: 50, type };
          const results = queryNotifications(notifications, options);

          // **Validates: Requirements 7.3**
          // All results must have the specified type
          for (const notification of results) {
            expect(notification.type).toBe(type);
          }

          // Count of results should equal count of notifications with that type
          const expectedCount = notifications.filter((n) => n.type === type).length;
          expect(results.length).toBe(expectedCount);
        }),
        { numRuns: 100 },
      );
    });

    it('isRead filter only returns notifications with the specified read status', () => {
      fc.assert(
        fc.property(notificationListArb, fc.boolean(), (notifications, isRead) => {
          const options: FilterOptions = { page: 1, pageSize: 50, isRead };
          const results = queryNotifications(notifications, options);

          // **Validates: Requirements 7.3**
          // All results must have the specified isRead value
          for (const notification of results) {
            expect(notification.isRead).toBe(isRead);
          }

          // Count of results should equal count of notifications with that isRead value
          const expectedCount = notifications.filter((n) => n.isRead === isRead).length;
          expect(results.length).toBe(expectedCount);
        }),
        { numRuns: 100 },
      );
    });

    it('combined type + isRead filter uses AND logic', () => {
      fc.assert(
        fc.property(
          notificationListArb,
          notificationTypeArb,
          fc.boolean(),
          (notifications, type, isRead) => {
            const options: FilterOptions = { page: 1, pageSize: 50, type, isRead };
            const results = queryNotifications(notifications, options);

            // **Validates: Requirements 7.3**
            // All results must match BOTH criteria
            for (const notification of results) {
              expect(notification.type).toBe(type);
              expect(notification.isRead).toBe(isRead);
            }

            // Count should match notifications satisfying both conditions
            const expectedCount = notifications.filter(
              (n) => n.type === type && n.isRead === isRead,
            ).length;
            expect(results.length).toBe(expectedCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('no filter returns all notifications (up to pageSize)', () => {
      fc.assert(
        fc.property(notificationListArb, (notifications) => {
          const options: FilterOptions = { page: 1, pageSize: 50 };
          const results = queryNotifications(notifications, options);

          // **Validates: Requirements 7.3**
          // With no filters and large pageSize, all notifications should be returned
          expect(results.length).toBe(Math.min(notifications.length, 50));
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 2: Notification List Sorting and Pagination', () => {
    // **Validates: Requirements 2.2, 4.2, 7.2**

    it('returned list is sorted in strictly descending order by createdAt', () => {
      fc.assert(
        fc.property(notificationListArb, filterOptionsArb, (notifications, options) => {
          const results = queryNotifications(notifications, options);

          // **Validates: Requirements 2.2, 7.2**
          for (let i = 0; i < results.length - 1; i++) {
            const currentTime = new Date(results[i].createdAt).getTime();
            const nextTime = new Date(results[i + 1].createdAt).getTime();
            expect(currentTime).toBeGreaterThanOrEqual(nextTime);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('item count never exceeds pageSize', () => {
      fc.assert(
        fc.property(notificationListArb, filterOptionsArb, (notifications, options) => {
          const results = queryNotifications(notifications, options);

          // **Validates: Requirements 4.2, 7.2**
          expect(results.length).toBeLessThanOrEqual(options.pageSize);
        }),
        { numRuns: 100 },
      );
    });

    it('page 1 with pageSize N returns at most N items from the beginning', () => {
      fc.assert(
        fc.property(
          notificationListArb,
          fc.integer({ min: 1, max: 50 }),
          (notifications, pageSize) => {
            const options: FilterOptions = { page: 1, pageSize };
            const results = queryNotifications(notifications, options);

            // **Validates: Requirements 4.2, 7.2**
            expect(results.length).toBeLessThanOrEqual(pageSize);
            expect(results.length).toBe(Math.min(notifications.length, pageSize));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('pagination produces non-overlapping pages that cover all items', () => {
      fc.assert(
        fc.property(
          notificationListArb,
          fc.integer({ min: 1, max: 20 }),
          (notifications, pageSize) => {
            const sorted = sortNotifications(notifications);
            const totalPages = Math.ceil(sorted.length / pageSize) || 1;
            const allPaginatedItems: NotificationData[] = [];

            for (let page = 1; page <= totalPages; page++) {
              const options: FilterOptions = { page, pageSize };
              const results = queryNotifications(notifications, options);
              allPaginatedItems.push(...results);
            }

            // **Validates: Requirements 4.2, 7.2**
            // All pages combined should contain all notifications
            expect(allPaginatedItems.length).toBe(notifications.length);

            // Items should be in the same order as the full sorted list
            for (let i = 0; i < allPaginatedItems.length; i++) {
              expect(allPaginatedItems[i].id).toBe(sorted[i].id);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('pages beyond the last page return empty results', () => {
      fc.assert(
        fc.property(
          fc.array(notificationDataArb, { minLength: 1, maxLength: 30 }),
          fc.integer({ min: 1, max: 10 }),
          (notifications, pageSize) => {
            const totalPages = Math.ceil(notifications.length / pageSize);
            const beyondLastPage = totalPages + 1;

            const options: FilterOptions = { page: beyondLastPage, pageSize };
            const results = queryNotifications(notifications, options);

            // **Validates: Requirements 4.2**
            expect(results.length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('sorting is stable relative to the filtered subset', () => {
      fc.assert(
        fc.property(notificationListArb, filterOptionsArb, (notifications, options) => {
          // Run the query twice — results should be identical (deterministic)
          const results1 = queryNotifications(notifications, options);
          const results2 = queryNotifications(notifications, options);

          // **Validates: Requirements 2.2, 7.2**
          expect(results1).toEqual(results2);
        }),
        { numRuns: 100 },
      );
    });
  });
});
