import { createColumnHelper } from '@tanstack/react-table';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { CustomerListItem, CustomerTier } from '@surewaka/shared';

const columnHelper = createColumnHelper<CustomerListItem>();

function TierBadge({ tier }: { tier: CustomerTier | null }) {
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

function formatCurrency(kobo: number): string {
  const naira = kobo / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(naira);
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function AvatarCell({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {initials}
        </div>
      )}
      <span className="font-medium">{name}</span>
    </div>
  );
}

export const columns = [
  columnHelper.display({
    id: 'name',
    header: 'Customer',
    cell: (info) => (
      <AvatarCell name={info.row.original.name} avatarUrl={info.row.original.avatarUrl} />
    ),
    enableSorting: true,
  }),
  columnHelper.accessor('phone', {
    header: 'Phone',
    cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
    enableSorting: false,
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    cell: (info) => (
      <span className="text-sm text-muted-foreground">{info.getValue() ?? '—'}</span>
    ),
    enableSorting: false,
  }),
  columnHelper.accessor('totalDeliveries', {
    header: 'Deliveries',
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    enableSorting: true,
  }),
  columnHelper.accessor('totalSpent', {
    header: 'Total Spent',
    cell: (info) => (
      <span className="tabular-nums">{formatCurrency(info.getValue())}</span>
    ),
    enableSorting: true,
  }),
  columnHelper.accessor('lastDeliveryAt', {
    header: 'Last Active',
    cell: (info) => (
      <span className="text-sm text-muted-foreground" title={info.getValue() ?? undefined}>
        {formatRelativeTime(info.getValue())}
      </span>
    ),
    enableSorting: true,
  }),
  columnHelper.accessor('tier', {
    header: 'Tier',
    cell: (info) => <TierBadge tier={info.getValue()} />,
    enableSorting: false,
  }),
  columnHelper.accessor('verified', {
    header: 'Verified',
    cell: (info) =>
      info.getValue() ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" />
      ),
    enableSorting: false,
  }),
  columnHelper.accessor('createdAt', {
    header: 'Joined',
    cell: (info) => (
      <span className="text-sm text-muted-foreground">
        {new Date(info.getValue()).toLocaleDateString('en-NG', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </span>
    ),
    enableSorting: true,
  }),
];
