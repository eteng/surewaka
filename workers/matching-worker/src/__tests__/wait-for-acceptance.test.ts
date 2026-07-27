import { describe, it, expect, vi } from 'vitest';
import { waitForAcceptance } from '../lib/wait-for-acceptance';
import type IORedis from 'ioredis';

function createMockRedis(getFn: (...args: unknown[]) => Promise<string | null>) {
  return { get: getFn } as unknown as IORedis;
}

describe('waitForAcceptance', () => {
  it('returns driver ID immediately when claim key exists on first poll', async () => {
    const mockGet = vi.fn().mockResolvedValue('driver-123');
    const redis = createMockRedis(mockGet);

    const result = await waitForAcceptance(redis, 'delivery-abc', 2000);

    expect(result).toBe('driver-123');
    expect(mockGet).toHaveBeenCalledWith('delivery:delivery-abc:claim');
  });

  it('returns driver ID when claim appears after a few polls', async () => {
    let callCount = 0;
    const mockGet = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount >= 3) return 'driver-456';
      return null;
    });
    const redis = createMockRedis(mockGet);

    const result = await waitForAcceptance(redis, 'delivery-xyz', 5000);

    expect(result).toBe('driver-456');
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('returns null when timeout expires without a claim', async () => {
    const mockGet = vi.fn().mockResolvedValue(null);
    const redis = createMockRedis(mockGet);

    const start = Date.now();
    const result = await waitForAcceptance(redis, 'delivery-timeout', 600);
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // Should have waited approximately the timeout duration
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(1500);
  });

  it('polls the correct Redis key pattern', async () => {
    const mockGet = vi.fn().mockResolvedValueOnce('winner');
    const redis = createMockRedis(mockGet);

    await waitForAcceptance(redis, 'my-delivery-id', 3000);

    expect(mockGet).toHaveBeenCalledWith('delivery:my-delivery-id:claim');
  });

  it('handles very short timeouts without hanging', async () => {
    const mockGet = vi.fn().mockResolvedValue(null);
    const redis = createMockRedis(mockGet);

    const start = Date.now();
    const result = await waitForAcceptance(redis, 'delivery-fast', 50);
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // Should complete quickly
    expect(elapsed).toBeLessThan(1000);
  });

  it('does not poll excessively after finding a claim', async () => {
    const mockGet = vi.fn().mockResolvedValueOnce('driver-first');
    const redis = createMockRedis(mockGet);

    await waitForAcceptance(redis, 'delivery-once', 5000);

    // Should only have polled once since claim was found immediately
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('polls at approximately 500ms intervals', async () => {
    const timestamps: number[] = [];
    const mockGet = vi.fn().mockImplementation(async () => {
      timestamps.push(Date.now());
      if (timestamps.length >= 4) return 'claimed';
      return null;
    });
    const redis = createMockRedis(mockGet);

    await waitForAcceptance(redis, 'delivery-interval', 5000);

    // Should have polled 4 times
    expect(timestamps.length).toBe(4);

    // Check intervals between polls are approximately 500ms (allow margin for async execution)
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(450);
      expect(gap).toBeLessThan(650);
    }
  });
});
