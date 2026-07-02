import { describe, it, expect } from 'vitest';
import {
  createDeliveryLegSchema,
  recordDriverLocationSchema,
  submitDeliveryRatingSchema,
  overrideFailureCauseSchema,
} from '../validators';

describe('createDeliveryLegSchema', () => {
  it('accepts a valid first_mile leg', () => {
    const result = createDeliveryLegSchema.safeParse({
      deliveryId: '00000000-0000-0000-0000-000000000001',
      legNumber: 1,
      legType: 'first_mile',
      actorType: 'driver',
      actorId: '00000000-0000-0000-0000-000000000002',
      pickupAddress: '12 Adeola Odeku, Victoria Island',
      pickupLat: 6.4281,
      pickupLng: 3.4219,
      dropoffAddress: 'Mile 2 Park, Amuwo-Odofin',
      dropoffLat: 6.4698,
      dropoffLng: 3.3113,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid legType', () => {
    const result = createDeliveryLegSchema.safeParse({
      deliveryId: '00000000-0000-0000-0000-000000000001',
      legNumber: 1,
      legType: 'overnight',
      actorType: 'driver',
      actorId: '00000000-0000-0000-0000-000000000002',
      pickupAddress: '12 Adeola Odeku',
      pickupLat: 6.4281,
      pickupLng: 3.4219,
      dropoffAddress: 'Mile 2 Park',
      dropoffLat: 6.4698,
      dropoffLng: 3.3113,
    });
    expect(result.success).toBe(false);
  });
});

describe('recordDriverLocationSchema', () => {
  it('accepts valid coords with optional deliveryId', () => {
    const result = recordDriverLocationSchema.safeParse({
      lat: 6.5244,
      lng: 3.3792,
      deliveryId: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('rejects lat out of range', () => {
    const result = recordDriverLocationSchema.safeParse({ lat: 200, lng: 3.3792 });
    expect(result.success).toBe(false);
  });
});

describe('submitDeliveryRatingSchema', () => {
  it('rejects rating 0 and 6', () => {
    expect(submitDeliveryRatingSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(submitDeliveryRatingSchema.safeParse({ rating: 6 }).success).toBe(false);
  });

  it('accepts rating 1–5 with optional comment', () => {
    expect(submitDeliveryRatingSchema.safeParse({ rating: 4, comment: 'Fast!' }).success).toBe(true);
  });
});

describe('overrideFailureCauseSchema', () => {
  it('rejects unknown failure cause', () => {
    const result = overrideFailureCauseSchema.safeParse({ failureCause: 'weather' });
    expect(result.success).toBe(false);
  });

  it('accepts valid cause with note', () => {
    const result = overrideFailureCauseSchema.safeParse({
      failureCause: 'route_traffic',
      failureNote: 'Third Mainland Bridge closure',
    });
    expect(result.success).toBe(true);
  });
});
