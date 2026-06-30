import type { CustomerTier } from '@surewaka/shared';

export function TierBadge({ tier }: { tier: CustomerTier | null }) {
  if (!tier) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const styles: Record<CustomerTier, string> = {
    power: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    regular: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    new: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    dormant: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[tier]}`}
    >
      {tier.charAt(0).toUpperCase() + tier.slice(1)}
    </span>
  );
}
