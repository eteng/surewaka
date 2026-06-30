import { CheckCircle2, XCircle, Mail, Phone } from 'lucide-react';
import type { CustomerDetail } from '@surewaka/shared';
import { TierBadge } from '~/components/customers/tier-badge';
import { formatDate } from '~/lib/format';

export function ProfileHeader({ customer }: { customer: CustomerDetail }) {
  const initials = customer.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-start gap-6 rounded-lg border bg-card p-6">
      {/* Avatar */}
      {customer.avatarUrl ? (
        <img
          src={customer.avatarUrl}
          alt={customer.name}
          className="h-16 w-16 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
          {initials}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{customer.name}</h1>
          <TierBadge tier={customer.tier} />
          {customer.verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
              <XCircle className="h-3 w-3" /> Unverified
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {customer.email && (
            <span className="flex items-center gap-1">
              <Mail className="h-4 w-4" /> {customer.email}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Phone className="h-4 w-4" /> {customer.phone}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Member since {formatDate(customer.createdAt)}
          {customer.primaryCity && ` · ${customer.primaryCity}`}
        </p>
      </div>
    </div>
  );
}
