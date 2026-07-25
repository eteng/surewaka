import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @surewaka/db
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock('@surewaka/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
  deliveries: 'deliveries',
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });

// Mock the routing enqueue function
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/routing-enqueue', () => ({
  enqueueRouteDelivery: (...args: unknown[]) => mockEnqueue(...args),
}));

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ['eq', ...args]),
  and: vi.fn((...args: unknown[]) => ['and', ...args]),
  lt: vi.fn((...args: unknown[]) => ['lt', ...args]),
}));

import { rescueStaleRouting } from '../rescue-stale-routing';

describe('rescueStaleRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it('re-enqueues stale deliveries', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'delivery-1' },
      { id: 'delivery-2' },
    ]);

    await rescueStaleRouting();

    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        vehicleType: 'motorcycle',
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-2',
        vehicleType: 'motorcycle',
      }),
    );
    // bookingTime should be a fresh ISO string
    const firstCall = mockEnqueue.mock.calls[0][0];
    expect(new Date(firstCall.bookingTime).getTime()).toBeCloseTo(Date.now(), -3);
  });

  it('does nothing when no stale deliveries found', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await rescueStaleRouting();

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
