import { describe, it, expect } from 'vitest';
import { useRoles } from './use-roles';

describe('useRoles', () => {
  it('defaults to customer when appMetadata is undefined', () => {
    const ctx = useRoles(undefined);
    expect(ctx.roles).toEqual(['customer']);
    expect(ctx.isCustomer).toBe(true);
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.carrierId).toBeUndefined();
  });

  it('defaults to customer when roles array is empty', () => {
    const ctx = useRoles({ roles: [] });
    expect(ctx.roles).toEqual(['customer']);
    expect(ctx.isCustomer).toBe(true);
  });

  it('defaults to customer when roles is undefined in metadata', () => {
    const ctx = useRoles({});
    expect(ctx.roles).toEqual(['customer']);
    expect(ctx.isCustomer).toBe(true);
  });

  it('returns the provided roles when present', () => {
    const ctx = useRoles({ roles: ['driver', 'carrier_driver'] });
    expect(ctx.roles).toEqual(['driver', 'carrier_driver']);
    expect(ctx.isDriver).toBe(true);
    expect(ctx.isCarrierDriver).toBe(true);
    expect(ctx.isCustomer).toBe(false);
  });

  it('sets convenience booleans correctly for surewaka_admin', () => {
    const ctx = useRoles({ roles: ['surewaka_admin'] });
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.isSupport).toBe(false);
    expect(ctx.isDriver).toBe(false);
  });

  it('sets convenience booleans correctly for support_agent', () => {
    const ctx = useRoles({ roles: ['support_agent'] });
    expect(ctx.isSupport).toBe(true);
    expect(ctx.isAdmin).toBe(false);
  });

  it('sets convenience booleans correctly for carrier_admin', () => {
    const ctx = useRoles({ roles: ['carrier_admin'], carrier_id: 'carrier-123' });
    expect(ctx.isCarrierAdmin).toBe(true);
    expect(ctx.carrierId).toBe('carrier-123');
  });

  describe('hasRole', () => {
    it('returns true when user holds the specified role', () => {
      const ctx = useRoles({ roles: ['driver'] });
      expect(ctx.hasRole('driver')).toBe(true);
    });

    it('returns false when user does not hold the specified role', () => {
      const ctx = useRoles({ roles: ['customer'] });
      expect(ctx.hasRole('driver')).toBe(false);
    });

    it('surewaka_admin always returns true for any role', () => {
      const ctx = useRoles({ roles: ['surewaka_admin'] });
      expect(ctx.hasRole('driver')).toBe(true);
      expect(ctx.hasRole('carrier_admin')).toBe(true);
      expect(ctx.hasRole('support_agent')).toBe(true);
      expect(ctx.hasRole('customer')).toBe(true);
    });
  });

  describe('hasAnyRole', () => {
    it('returns true when user holds at least one of the specified roles', () => {
      const ctx = useRoles({ roles: ['driver'] });
      expect(ctx.hasAnyRole('driver', 'carrier_admin')).toBe(true);
    });

    it('returns false when user holds none of the specified roles', () => {
      const ctx = useRoles({ roles: ['customer'] });
      expect(ctx.hasAnyRole('driver', 'carrier_admin')).toBe(false);
    });

    it('surewaka_admin always returns true for any combination', () => {
      const ctx = useRoles({ roles: ['surewaka_admin'] });
      expect(ctx.hasAnyRole('driver', 'carrier_admin')).toBe(true);
    });
  });

  it('extracts carrierId from app_metadata', () => {
    const ctx = useRoles({
      roles: ['carrier_driver'],
      carrier_id: 'abc-123-def',
    });
    expect(ctx.carrierId).toBe('abc-123-def');
  });

  it('carrierId is undefined when not provided', () => {
    const ctx = useRoles({ roles: ['customer'] });
    expect(ctx.carrierId).toBeUndefined();
  });

  it('supports multiple simultaneous roles', () => {
    const ctx = useRoles({
      roles: ['carrier_admin', 'driver'],
      carrier_id: 'carrier-xyz',
    });
    expect(ctx.isCarrierAdmin).toBe(true);
    expect(ctx.isDriver).toBe(true);
    expect(ctx.isCustomer).toBe(false);
    expect(ctx.hasRole('carrier_admin')).toBe(true);
    expect(ctx.hasRole('driver')).toBe(true);
    expect(ctx.carrierId).toBe('carrier-xyz');
  });
});
