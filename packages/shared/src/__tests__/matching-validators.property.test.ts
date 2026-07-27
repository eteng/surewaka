import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  driverLocationUpdateSchema,
  acceptDeliverySchema,
  matchDriverJobDataSchema,
} from '../validators';

/**
 * **Validates: Requirement 16.4**
 *
 * Property 19: Input Validation Rejection — invalid coordinates, UUIDs,
 * or enums are rejected before processing.
 */
describe('Property 19: Input Validation Rejection', () => {
  describe('driverLocationUpdateSchema', () => {
    it('accepts valid coordinates (lat in [-90,90], lng in [-180,180])', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.double({ min: -180, max: 180, noNaN: true }),
          (lat, lng) => {
            const result = driverLocationUpdateSchema.safeParse({ lat, lng });
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects latitude outside [-90, 90]', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: 91, max: 1000, noNaN: true }),
            fc.double({ min: -1000, max: -91, noNaN: true }),
          ),
          fc.double({ min: -180, max: 180, noNaN: true }),
          (lat, lng) => {
            const result = driverLocationUpdateSchema.safeParse({ lat, lng });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects longitude outside [-180, 180]', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.oneof(
            fc.double({ min: 181, max: 1000, noNaN: true }),
            fc.double({ min: -1000, max: -181, noNaN: true }),
          ),
          (lat, lng) => {
            const result = driverLocationUpdateSchema.safeParse({ lat, lng });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects non-number lat/lng', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
          (invalidValue) => {
            const result = driverLocationUpdateSchema.safeParse({ lat: invalidValue, lng: 3.0 });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('acceptDeliverySchema', () => {
    it('accepts valid UUIDs', () => {
      fc.assert(
        fc.property(fc.uuid(), (deliveryId) => {
          const result = acceptDeliverySchema.safeParse({ deliveryId });
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('rejects invalid UUID formats', () => {
      fc.assert(
        fc.property(
          fc
            .string()
            .filter(
              (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
            ),
          (invalidId) => {
            const result = acceptDeliverySchema.safeParse({ deliveryId: invalidId });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('matchDriverJobDataSchema', () => {
    it('accepts valid complete job data', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.constantFrom('motorcycle', 'car', 'van', 'truck'),
          fc.uuid(),
          (deliveryId, pickupLng, pickupLat, vehicleType, customerId) => {
            const result = matchDriverJobDataSchema.safeParse({
              deliveryId,
              pickupLng,
              pickupLat,
              vehicleType,
              customerId,
            });
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects invalid vehicle type', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.string().filter((s) => !['motorcycle', 'car', 'van', 'truck'].includes(s)),
          fc.uuid(),
          (deliveryId, pickupLng, pickupLat, vehicleType, customerId) => {
            const result = matchDriverJobDataSchema.safeParse({
              deliveryId,
              pickupLng,
              pickupLat,
              vehicleType,
              customerId,
            });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('rejects invalid pickupLat outside [-90, 90]', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.oneof(
            fc.double({ min: 91, max: 1000, noNaN: true }),
            fc.double({ min: -1000, max: -91, noNaN: true }),
          ),
          fc.constantFrom('motorcycle', 'car', 'van', 'truck'),
          fc.uuid(),
          (deliveryId, pickupLng, pickupLat, vehicleType, customerId) => {
            const result = matchDriverJobDataSchema.safeParse({
              deliveryId,
              pickupLng,
              pickupLat,
              vehicleType,
              customerId,
            });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('rejects invalid customerId (non-UUID)', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.constantFrom('motorcycle', 'car', 'van', 'truck'),
          fc
            .string()
            .filter(
              (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
            ),
          (deliveryId, pickupLng, pickupLat, vehicleType, customerId) => {
            const result = matchDriverJobDataSchema.safeParse({
              deliveryId,
              pickupLng,
              pickupLat,
              vehicleType,
              customerId,
            });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
