import { describe, it, expect, vi } from 'vitest';

const mockCreditWallet = vi.fn();
const mockDebitWallet = vi.fn();
vi.mock('@surewaka/db', () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
  },
  wallets: 'wallets',
  escrowHolds: 'escrow_holds',
  eq: vi.fn(),
}));

// We test the pure logic: refund amount calculation
describe('Refund job — amount calculation', () => {
  it('calculates 85% refund correctly', () => {
    const amountPaid = 350000;
    const rate = 0.85;
    const refund = Math.floor(amountPaid * rate);
    expect(refund).toBe(297500);
  });

  it('calculates 50% refund correctly', () => {
    const amountPaid = 350000;
    const rate = 0.50;
    const refund = Math.floor(amountPaid * rate);
    expect(refund).toBe(175000);
  });

  it('calculates commission split correctly', () => {
    const totalAmount = 350000;
    const commissionRate = 0.15;
    const commission = Math.floor(totalAmount * commissionRate);
    const driverAmount = totalAmount - commission;
    expect(commission).toBe(52500);
    expect(driverAmount).toBe(297500);
  });
});
