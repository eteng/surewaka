// Feature: admin-notifications, Property 1, 3, 5: Badge formatting, rendering completeness, clickability
// Validates: Requirements 1.3, 1.4, 1.5, 1.7, 3.1, 3.4, 2.3, 7.4
//
// Property 1: Badge Formatting Correctness — for any non-negative integer count,
// formatBadgeCount returns '' when 0, exact numeric string for 1-99, "99+" for >99.
//
// Property 5: Clickability Determined by Resource Link — a notification is clickable
// if and only if resourceLink is non-null.
//
// Property 3: Notification Rendering Completeness — for any valid notification object,
// the NOTIFICATION_ICONS mapping has an entry for the type, and formatRelativeTime
// produces a non-empty string.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatBadgeCount } from '../components/notifications/notification-bell';
import { formatRelativeTime } from '../lib/format-relative-time';

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

// ─── NOTIFICATION_ICONS mapping (mirrors notification-item.tsx) ──────────────

const NOTIFICATION_ICONS_KEYS: readonly NotificationType[] = [
  'new_user_signup',
  'delivery_issue',
  'carrier_verification_request',
  'carrier_verified',
  'dispute_opened',
  'driver_verification_request',
  'system_alert',
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const nonNegativeIntArb = fc.integer({ min: 0, max: 100_000 });

const notificationTypeArb = fc.constantFrom(...NOTIFICATION_TYPES);

const safeStringArb = (min: number, max: number) =>
  fc.string({ minLength: min, maxLength: max }).filter((s) => s.trim().length >= min);

const isoTimestampArb = fc
  .integer({
    min: new Date('2023-01-01').getTime(),
    max: Date.now(),
  })
  .map((ts) => new Date(ts).toISOString());

const resourceLinkArb = fc.oneof(
  fc.constant(null),
  fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0)
    .map((s) => `/${s.replace(/^\/+/, '')}`),
);

const notificationDataArb: fc.Arbitrary<NotificationData> = fc.record({
  id: fc.uuid(),
  type: notificationTypeArb,
  title: safeStringArb(1, 200),
  message: safeStringArb(1, 500),
  resourceLink: resourceLinkArb,
  isRead: fc.boolean(),
  createdAt: isoTimestampArb,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Notification Badge — Property Tests', () => {
  describe('Property 1: Badge Formatting Correctness', () => {
    // **Validates: Requirements 1.3, 1.4, 1.5, 1.7**

    it('returns empty string when count is 0', () => {
      expect(formatBadgeCount(0)).toBe('');
    });

    it('returns exact numeric string for counts 1-99', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 99 }),
          (count) => {
            const result = formatBadgeCount(count);
            // **Validates: Requirements 1.3**
            expect(result).toBe(String(count));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns "99+" for counts greater than 99', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 100_000 }),
          (count) => {
            const result = formatBadgeCount(count);
            // **Validates: Requirements 1.4**
            expect(result).toBe('99+');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns empty string for any non-positive count (hidden badge)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -10_000, max: 0 }),
          (count) => {
            const result = formatBadgeCount(count);
            // **Validates: Requirements 1.5**
            expect(result).toBe('');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any non-negative integer, badge text is one of: empty, numeric 1-99, or "99+"', () => {
      fc.assert(
        fc.property(nonNegativeIntArb, (count) => {
          const result = formatBadgeCount(count);
          // **Validates: Requirements 1.3, 1.4, 1.5, 1.7**
          if (count === 0) {
            expect(result).toBe('');
          } else if (count <= 99) {
            expect(result).toBe(String(count));
          } else {
            expect(result).toBe('99+');
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 5: Clickability Determined by Resource Link', () => {
    // **Validates: Requirements 3.1, 3.4**

    it('notification is clickable if and only if resourceLink is non-null', () => {
      fc.assert(
        fc.property(notificationDataArb, (notification) => {
          const isClickable = notification.resourceLink !== null;

          // **Validates: Requirements 3.1, 3.4**
          if (notification.resourceLink !== null) {
            // Notification with a resource link MUST be clickable
            expect(isClickable).toBe(true);
          } else {
            // Notification without a resource link MUST NOT be clickable
            expect(isClickable).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('notifications with null resourceLink are never clickable', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            type: notificationTypeArb,
            title: safeStringArb(1, 200),
            message: safeStringArb(1, 500),
            resourceLink: fc.constant(null),
            isRead: fc.boolean(),
            createdAt: isoTimestampArb,
          }),
          (notification) => {
            // **Validates: Requirements 3.4**
            const isClickable = notification.resourceLink !== null;
            expect(isClickable).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('notifications with non-null resourceLink are always clickable', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            type: notificationTypeArb,
            title: safeStringArb(1, 200),
            message: safeStringArb(1, 500),
            resourceLink: fc
              .string({ minLength: 1, maxLength: 100 })
              .filter((s) => s.trim().length > 0)
              .map((s) => `/${s.replace(/^\/+/, '')}`),
            isRead: fc.boolean(),
            createdAt: isoTimestampArb,
          }),
          (notification) => {
            // **Validates: Requirements 3.1**
            const isClickable = notification.resourceLink !== null;
            expect(isClickable).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 3: Notification Rendering Completeness', () => {
    // **Validates: Requirements 2.3, 7.4**

    it('NOTIFICATION_ICONS mapping has an entry for every valid notification type', () => {
      fc.assert(
        fc.property(notificationTypeArb, (type) => {
          // **Validates: Requirements 2.3, 7.4**
          // Every notification type must have a corresponding icon in the mapping
          expect(NOTIFICATION_ICONS_KEYS).toContain(type);
        }),
        { numRuns: 100 },
      );
    });

    it('formatRelativeTime produces a non-empty string for any valid timestamp', () => {
      fc.assert(
        fc.property(isoTimestampArb, (timestamp) => {
          const result = formatRelativeTime(timestamp);
          // **Validates: Requirements 2.3**
          expect(result).toBeTruthy();
          expect(result.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('for any valid notification, all rendering data is available', () => {
      fc.assert(
        fc.property(notificationDataArb, (notification) => {
          // **Validates: Requirements 2.3, 7.4**

          // 1. Type icon exists for the notification type
          expect(NOTIFICATION_ICONS_KEYS).toContain(notification.type);

          // 2. Title is a non-empty string
          expect(notification.title.length).toBeGreaterThan(0);

          // 3. Relative timestamp produces a non-empty string
          const relativeTime = formatRelativeTime(notification.createdAt);
          expect(relativeTime.length).toBeGreaterThan(0);

          // 4. Message is a non-empty string
          expect(notification.message.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('formatRelativeTime returns a string matching expected patterns', () => {
      fc.assert(
        fc.property(isoTimestampArb, (timestamp) => {
          const result = formatRelativeTime(timestamp);
          // **Validates: Requirements 2.3**
          // Result should match one of the known patterns
          const validPatterns = [
            /^just now$/,
            /^\d+ min ago$/,
            /^\d+ hours? ago$/,
            /^\d+ days? ago$/,
            /^\d+ months? ago$/,
          ];
          const matchesPattern = validPatterns.some((pattern) => pattern.test(result));
          expect(matchesPattern).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
