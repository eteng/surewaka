/**
 * Format an ISO date string into a human-readable date (en-NG locale).
 * Example: "2024-03-15T10:30:00Z" → "Mar 15, 2024"
 */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a number as Nigerian Naira currency.
 * Example: 15000 → "₦15,000"
 */
export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
