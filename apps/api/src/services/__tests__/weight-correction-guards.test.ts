import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_WEIGHT_CORRECTION_MULTIPLIER,
  MIN_WEIGHT_CORRECTION_KG,
} from '@surewaka/shared';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();

vi.mock('@surewaka/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
  },
  deliveries: 'deliveries',
  deliveryLegs: 'deliveryLegs',
  quotes: 'quotes',
  weightDiscrepancyCorrections: 'weightDiscrepancyCorrections',
  escrowHolds: 'escrowHolds',
  alerts: 'alerts',
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  lt: vi.fn(),
  gte: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('../../lib/fee-engine', () => ({
  computeOnDemandQuote: vi.fn().mockReturnValue({
    lineItems: [{ label: 'Base fee', amountKobo: 200000 }],
    totalKobo: 200000,
  }),
}));

vi.mock('../../lib/wallet-service', () => ({
  creditWallet: vi.fn(),
  debitWallet: vi.fn(),
  getWalletByUserId: vi.fn(),
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { reportDiscrepancy } from '../weight-correction-service';

// ─── Test Setup ───────────────────────────────────────────────────────────────

const mockDb = {
  select: () => ({ from: mockFrom }),
  insert: () => ({ values: mockValues }),
} as unknown as Parameters<typeof reportDiscrepancy>[0];

const mockSettings = {
  baseRateKobo: 200000,
  perKgRateKobo: 20000,
  perKmRateKobo: 15000,
  carrierCommissionRatePct: 15,
  taxRatePct: 0,
  minPriceKobo: 50000,
  weightCorrectionApprovalWindowMin: 10,
  withdrawalFeeKobo: 10000,
};

const mockVehicleTypeRates = {
  motorcycle: { multiplier: 1.0 },
  car: { multiplier: 1.3 },
  van: { multiplier: 1.6 },
  truck: { multiplier: 2.0 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Weight Correction Guards', () => {
  describe('Minimum delta threshold (WITHIN_TOLERANCE)', () => {
    it('throws WITHIN_TOLERANCE when delta < 0.5kg', async () => {
      // Mock delivery lookup returns 5kg declared weight
      mockFrom.mockReturnValueOnce({
        where: () => ({ limit: () => Promise.resolve([{ packageWeight: 5.0 }]) }),
      });

      await expect(
        reportDiscrepancy(mockDb, 'del-1', 'leg-1', 5.3, mockSettings, mockVehicleTypeRates),
      ).rejects.toThrow('WITHIN_TOLERANCE');
    });

    it('does NOT throw for delta exactly 0.5kg', async () => {
      // 5.0 → 5.5 = 0.5kg delta (at threshold, should proceed)
      mockFrom
        .mockReturnValueOnce({
          where: () => ({ limit: () => Promise.resolve([{ packageWeight: 5.0 }]) }),
        })
        // Mock on-demand legs query
        .mockReturnValueOnce({
          where: () => Promise.resolve([{ id: 'leg-1', legType: 'first_mile' }]),
        })
        // Mock quote query
        .mockReturnValueOnce({
          where: () => ({ limit: () => Promise.resolve([{
            totalKobo: 300000,
            distanceKm: 5.0,
            lineItems: [{ label: 'Vehicle type (motorcycle × 1)', amountKobo: 0 }],
          }]) }),
        });

      // Mock insert for correction row
      mockValues.mockReturnValueOnce({
        returning: () => Promise.resolve([{ id: 'correction-1' }]),
      });

      // Should NOT throw — 0.5 is at the boundary (≥ threshold)
      const result = await reportDiscrepancy(mockDb, 'del-1', 'leg-1', 5.5, mockSettings, mockVehicleTypeRates);
      expect(result.correctionId).toBe('correction-1');
    });
  });

  describe('Maximum delta cap (WEIGHT_DELTA_TOO_LARGE)', () => {
    it('throws WEIGHT_DELTA_TOO_LARGE when reported > 3× declared', async () => {
      // 5kg declared, 16kg reported = 3.2× > 3×
      mockFrom.mockReturnValueOnce({
        where: () => ({ limit: () => Promise.resolve([{ packageWeight: 5.0 }]) }),
      });

      await expect(
        reportDiscrepancy(mockDb, 'del-1', 'leg-1', 16.0, mockSettings, mockVehicleTypeRates),
      ).rejects.toThrow('WEIGHT_DELTA_TOO_LARGE');
    });

    it('does NOT throw for reported exactly 3× declared', async () => {
      // 5kg → 15kg = exactly 3× (at boundary, should proceed)
      mockFrom
        .mockReturnValueOnce({
          where: () => ({ limit: () => Promise.resolve([{ packageWeight: 5.0 }]) }),
        })
        .mockReturnValueOnce({
          where: () => Promise.resolve([{ id: 'leg-1', legType: 'first_mile' }]),
        })
        .mockReturnValueOnce({
          where: () => ({ limit: () => Promise.resolve([{
            totalKobo: 300000,
            distanceKm: 5.0,
            lineItems: [{ label: 'Vehicle type (motorcycle × 1)', amountKobo: 0 }],
          }]) }),
        });

      mockValues.mockReturnValueOnce({
        returning: () => Promise.resolve([{ id: 'correction-2' }]),
      });

      // 15.0 = 5.0 × 3 — exactly at the boundary, NOT greater than
      const result = await reportDiscrepancy(mockDb, 'del-1', 'leg-1', 15.0, mockSettings, mockVehicleTypeRates);
      expect(result.correctionId).toBe('correction-2');
    });
  });

  describe('Constants are correct', () => {
    it('MAX_WEIGHT_CORRECTION_MULTIPLIER is 3', () => {
      expect(MAX_WEIGHT_CORRECTION_MULTIPLIER).toBe(3);
    });

    it('MIN_WEIGHT_CORRECTION_KG is 0.5', () => {
      expect(MIN_WEIGHT_CORRECTION_KG).toBe(0.5);
    });
  });
});
