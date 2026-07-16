import { describe, it, expect } from 'vitest';
import { paystackTransferFee, paystackCollectionFee } from '../lib/paystack-fees';

describe('paystackTransferFee', () => {
  it('charges ₦10 for transfers ≤ ₦5,000', () => {
    expect(paystackTransferFee(500000)).toBe(1000);   // exactly ₦5,000
    expect(paystackTransferFee(100000)).toBe(1000);   // ₦1,000
  });

  it('charges ₦25 for transfers ₦5,001–₦50,000', () => {
    expect(paystackTransferFee(500100)).toBe(2500);   // ₦5,001 — below ₦10k, no stamp duty
    expect(paystackTransferFee(5000000)).toBe(7500);  // ₦50,000 — > ₦10k so + ₦50 stamp
  });

  it('charges ₦50 base fee for transfers > ₦50,000 (plus stamp duty)', () => {
    // ₦50,001 is also > ₦10k so stamp duty applies — total is ₦100 (tested in stamp duty suite)
    // Use a value just above ₦50k to confirm the base tier
    expect(paystackTransferFee(5000100)).toBe(5000 + 5000);  // ₦50 base + ₦50 stamp
  });

  it('adds ₦50 stamp duty for transfers > ₦10,000', () => {
    expect(paystackTransferFee(1000100)).toBe(2500 + 5000);  // ₦10,001 — ₦25 + ₦50 stamp
    expect(paystackTransferFee(5000100)).toBe(5000 + 5000);  // ₦50,001 — ₦50 + ₦50 stamp
  });

  it('no stamp duty for transfers ≤ ₦10,000', () => {
    expect(paystackTransferFee(1000000)).toBe(2500);  // exactly ₦10,000 — ₦25, no stamp
  });
});

describe('paystackCollectionFee', () => {
  describe('card channel', () => {
    it('charges 0 for amounts ≤ ₦2,500', () => {
      expect(paystackCollectionFee(250000, 'card')).toBe(0);
      expect(paystackCollectionFee(100000, 'card')).toBe(0);
    });

    it('charges 1.5% + ₦100 for amounts > ₦2,500', () => {
      expect(paystackCollectionFee(1000000, 'card')).toBe(Math.round(1000000 * 0.015) + 10000); // ₦10,000 → ₦250
    });

    it('caps at ₦2,000 for large amounts', () => {
      expect(paystackCollectionFee(50000000, 'card')).toBe(200000); // ₦500,000 → cap at ₦2,000
    });
  });

  describe('dedicated_nuban channel (DVA)', () => {
    it('charges flat ₦50 regardless of amount', () => {
      expect(paystackCollectionFee(100000, 'dedicated_nuban')).toBe(5000);
      expect(paystackCollectionFee(50000000, 'dedicated_nuban')).toBe(5000);
    });
  });

  describe('unknown channel defaults to card formula', () => {
    it('treats unknown channels as card', () => {
      expect(paystackCollectionFee(250000, 'mobile_money')).toBe(0);
    });
  });
});
