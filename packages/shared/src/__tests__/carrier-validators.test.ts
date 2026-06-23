import { describe, it, expect } from 'vitest';
import {
  submitCarrierApplicationSchema,
  approveCarrierApplicationSchema,
  rejectCarrierApplicationSchema,
} from '../validators';

describe('submitCarrierApplicationSchema', () => {
  const valid = {
    businessName: 'GIG Logistics',
    contactName: 'Adaeze Okafor',
    email: 'adaeze@giglogistics.com',
    phone: '+2348012345678',
    serviceAreas: ['Lagos'],
  };

  it('accepts a valid application', () => {
    expect(submitCarrierApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid Nigerian phone', () => {
    const result = submitCarrierApplicationSchema.safeParse({ ...valid, phone: '08012345678' });
    expect(result.success).toBe(false);
  });

  it('rejects empty serviceAreas', () => {
    const result = submitCarrierApplicationSchema.safeParse({ ...valid, serviceAreas: [] });
    expect(result.success).toBe(false);
  });

  it('rejects businessName shorter than 2 chars', () => {
    const result = submitCarrierApplicationSchema.safeParse({ ...valid, businessName: 'X' });
    expect(result.success).toBe(false);
  });
});

describe('approveCarrierApplicationSchema', () => {
  const valid = {
    carrierName: 'GIG Logistics',
    slug: 'gig-logistics',
    driverVettingEnabled: false,
    adminEmail: 'admin@gig.com',
  };

  it('accepts email-only invite', () => {
    expect(approveCarrierApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts phone-only invite', () => {
    const result = approveCarrierApplicationSchema.safeParse({
      ...valid,
      adminEmail: undefined,
      adminPhone: '+2348012345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when neither phone nor email provided', () => {
    const result = approveCarrierApplicationSchema.safeParse({
      carrierName: 'GIG Logistics',
      slug: 'gig-logistics',
      driverVettingEnabled: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid slug', () => {
    const result = approveCarrierApplicationSchema.safeParse({ ...valid, slug: 'GIG Logistics' });
    expect(result.success).toBe(false);
  });
});

describe('rejectCarrierApplicationSchema', () => {
  it('rejects reason shorter than 10 characters', () => {
    const result = rejectCarrierApplicationSchema.safeParse({ reason: 'Too bad' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid reason', () => {
    const result = rejectCarrierApplicationSchema.safeParse({
      reason: 'CAC number could not be verified after three attempts.',
    });
    expect(result.success).toBe(true);
  });
});
