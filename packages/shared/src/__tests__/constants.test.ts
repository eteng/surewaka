import { describe, it, expect } from 'vitest';
import {
  LAGOS_ZONES,
  DEFAULT_SLA_HOURS,
  CUSTOMER_FACING_STATUSES,
  ETA_MINUTES_PER_KM,
} from '../constants';

describe('delivery model constants', () => {
  it('LAGOS_ZONES contains the expected zones', () => {
    expect(LAGOS_ZONES).toContain('Lekki');
    expect(LAGOS_ZONES).toContain('Victoria Island');
    expect(LAGOS_ZONES).toContain('Ikeja');
    expect(LAGOS_ZONES).toContain('Other');
  });

  it('DEFAULT_SLA_HOURS covers all leg types', () => {
    expect(DEFAULT_SLA_HOURS.first_mile).toBe(1);
    expect(DEFAULT_SLA_HOURS.intercity).toBe(24);
    expect(DEFAULT_SLA_HOURS.last_mile).toBe(2);
  });

  it('CUSTOMER_FACING_STATUSES includes delivered but not en_route_pickup', () => {
    expect(CUSTOMER_FACING_STATUSES).toContain('delivered');
    expect(CUSTOMER_FACING_STATUSES).toContain('picked_up');
    expect(CUSTOMER_FACING_STATUSES).not.toContain('en_route_pickup');
    expect(CUSTOMER_FACING_STATUSES).not.toContain('draft');
  });

  it('ETA_MINUTES_PER_KM is defined for all vehicle types', () => {
    expect(ETA_MINUTES_PER_KM.motorcycle).toBeDefined();
    expect(ETA_MINUTES_PER_KM.car).toBeDefined();
    expect(ETA_MINUTES_PER_KM.van).toBeDefined();
    expect(ETA_MINUTES_PER_KM.truck).toBeDefined();
  });
});
