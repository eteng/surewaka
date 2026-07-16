export function paystackTransferFee(amountKobo: number): number {
  let baseFee: number;
  if (amountKobo <= 500000) {
    baseFee = 1000;       // ₦10
  } else if (amountKobo <= 5000000) {
    baseFee = 2500;       // ₦25
  } else {
    baseFee = 5000;       // ₦50
  }
  const stampDuty = amountKobo > 1000000 ? 5000 : 0;  // ₦50 for > ₦10,000
  return baseFee + stampDuty;
}

export function paystackCollectionFee(amountKobo: number, channel: string): number {
  if (channel === 'dedicated_nuban') return 5000;  // flat ₦50
  if (amountKobo <= 250000) return 0;              // ≤ ₦2,500 waived
  return Math.min(Math.round(amountKobo * 0.015) + 10000, 200000);
}
