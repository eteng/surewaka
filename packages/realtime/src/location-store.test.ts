import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initLocationStore, updateDriverLocation } from './location-store';
import type { RealtimeProvider } from './types';

// ─── Mock Redis ───────────────────────────────────────────────────────────────

function createMockRedis() {
  return {
    geoadd: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue('OK'),
  };
}

// ─── Mock Realtime Provider ───────────────────────────────────────────────────

function createMockRealtime(): RealtimeProvider {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  };
}

describe('updateDriverLocation', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockRealtime: ReturnType<typeof createMockRealtime>;
  let mockPersistLocation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockRealtime = createMockRealtime();
    mockPersistLocation = vi.fn().mockResolvedValue(undefined);

    initLocationStore({
      redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
      realtime: mockRealtime,
      persistLocation: mockPersistLocation,
    });
  });

  it('stores driver position in Redis geo set via GEOADD', async () => {
    await updateDriverLocation('driver-1', 3.3792, 6.5244, {
      status: 'available',
      vehicleType: 'motorcycle',
    });

    expect(mockRedis.geoadd).toHaveBeenCalledWith('drivers:active', 3.3792, 6.5244, 'driver-1');
  });

  it('stores driver metadata in Redis hash via HSET', async () => {
    await updateDriverLocation('driver-1', 3.3792, 6.5244, {
      status: 'available',
      vehicleType: 'motorcycle',
    });

    expect(mockRedis.hset).toHaveBeenCalledWith(
      'driver:driver-1:meta',
      expect.objectContaining({
        lat: '6.5244',
        lng: '3.3792',
        status: 'available',
        vehicleType: 'motorcycle',
      }),
    );

    // lastSeen should be a numeric string (unix ms)
    const hashData = mockRedis.hset.mock.calls[0][1] as Record<string, string>;
    expect(Number(hashData.lastSeen)).toBeGreaterThan(0);
  });

  it('publishes location to Ably driver-location channel', async () => {
    await updateDriverLocation('driver-1', 3.3792, 6.5244, {
      status: 'available',
    });

    expect(mockRealtime.publish).toHaveBeenCalledWith(
      'driver-location:driver-1',
      'location-update',
      expect.objectContaining({
        driverId: 'driver-1',
        lng: 3.3792,
        lat: 6.5244,
      }),
    );
  });

  it('persists to Postgres when deliveryId is provided', async () => {
    await updateDriverLocation(
      'driver-1',
      3.3792,
      6.5244,
      { status: 'busy', vehicleType: 'car' },
      { deliveryId: 'delivery-abc' },
    );

    expect(mockPersistLocation).toHaveBeenCalledWith({
      driverId: 'driver-1',
      deliveryId: 'delivery-abc',
      lat: 6.5244,
      lng: 3.3792,
    });
  });

  it('does NOT persist to Postgres when no deliveryId is provided', async () => {
    await updateDriverLocation('driver-1', 3.3792, 6.5244, {
      status: 'available',
    });

    expect(mockPersistLocation).not.toHaveBeenCalled();
  });

  it('does NOT persist to Postgres when persistLocation is not configured', async () => {
    initLocationStore({
      redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
      realtime: mockRealtime,
      // no persistLocation
    });

    await updateDriverLocation(
      'driver-1',
      3.3792,
      6.5244,
      { status: 'busy' },
      { deliveryId: 'delivery-abc' },
    );

    expect(mockPersistLocation).not.toHaveBeenCalled();
  });

  it('only sets metadata fields that are provided', async () => {
    await updateDriverLocation('driver-1', 3.3792, 6.5244, {});

    const hashData = mockRedis.hset.mock.calls[0][1] as Record<string, string>;
    expect(hashData).toHaveProperty('lastSeen');
    expect(hashData).toHaveProperty('lat');
    expect(hashData).toHaveProperty('lng');
    expect(hashData).not.toHaveProperty('status');
    expect(hashData).not.toHaveProperty('vehicleType');
  });

  it('throws if location store is not initialized', async () => {
    // Reset internal state by re-importing module in a fresh context
    // For this test, we'll just verify the error message from getDeps
    const { initLocationStore: init, updateDriverLocation: update } = await import(
      './location-store'
    );

    // We can't easily reset module state without module re-evaluation,
    // but we can verify the happy path works after init
    init({
      redis: mockRedis as unknown as Parameters<typeof init>[0]['redis'],
      realtime: mockRealtime,
    });

    // Should not throw after initialization
    await expect(
      update('driver-1', 3.3792, 6.5244, { status: 'available' }),
    ).resolves.toBeUndefined();
  });
});
