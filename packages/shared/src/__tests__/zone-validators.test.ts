import { describe, it, expect } from 'vitest';
import { createZoneSchema, updateZoneSchema, createCarrierSlaOverrideSchema } from '../validators';

describe('createZoneSchema', () => {
  const validBase = {
    name: 'Lekki',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['lekki', 'chevron', 'ajah'],
  };

  const validWithBbox = {
    ...validBase,
    swLat: 6.4,
    swLng: 3.4,
    neLat: 6.6,
    neLng: 3.6,
  };

  it('rejects empty keywords array', () => {
    const result = createZoneSchema.safeParse({ ...validBase, keywords: [] });
    expect(result.success).toBe(false);
  });

  it('rejects partial bounding box (only swLat provided)', () => {
    const result = createZoneSchema.safeParse({ ...validBase, swLat: 6.4 });
    expect(result.success).toBe(false);
  });

  it('rejects when sw_lat >= ne_lat', () => {
    const result = createZoneSchema.safeParse({
      ...validBase,
      swLat: 6.6,
      swLng: 3.4,
      neLat: 6.4,
      neLng: 3.6,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when sw_lng >= ne_lng', () => {
    const result = createZoneSchema.safeParse({
      ...validBase,
      swLat: 6.4,
      swLng: 3.6,
      neLat: 6.6,
      neLng: 3.4,
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid full input with bounding box', () => {
    const result = createZoneSchema.safeParse(validWithBbox);
    expect(result.success).toBe(true);
  });

  it('accepts valid input without bounding box', () => {
    const result = createZoneSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});

describe('updateZoneSchema', () => {
  it('accepts partial input (just name)', () => {
    const result = updateZoneSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });
});

describe('createCarrierSlaOverrideSchema', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('rejects non-UUID strings for originZoneId', () => {
    const result = createCarrierSlaOverrideSchema.safeParse({
      carrierId: validUuid,
      originZoneId: 'not-a-uuid',
      destinationZoneId: validUuid,
      slaHours: 24,
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid UUIDs', () => {
    const result = createCarrierSlaOverrideSchema.safeParse({
      carrierId: validUuid,
      originZoneId: validUuid,
      destinationZoneId: validUuid,
      slaHours: 24,
    });
    expect(result.success).toBe(true);
  });
});
