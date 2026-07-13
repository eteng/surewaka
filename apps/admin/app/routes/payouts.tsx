import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { cn } from '~/lib/utils';
import { useProfile } from '~/hooks/use-profile';
import { usePayouts } from '~/hooks/use-payouts';
import type { PayoutStatus } from '~/hooks/use-payouts';
import { formatDate, formatNaira } from '~/lib/format';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';

export function meta() {
  return [{ title: 'SureWaka Admin - Payouts' }];
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean; error: Error | null };

class PayoutsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {this.state.error?.message ?? 'An unexpected error occurred'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<PayoutStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  reversed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

function StatusBadge({ status }: { status: PayoutStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

const STATUSES: Array<PayoutStatus | 'all'> = [
  'all', 'pending', 'processing', 'completed', 'failed', 'reversed',
];

const TAB_LABELS: Record<PayoutStatus | 'all', string> = {
  all: 'All',
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  reversed: 'Reversed',
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function PayoutsPage() {
  const { profile, isLoading: profileLoading } = useProfile();
  const [activeStatus, setActiveStatus] = useState<PayoutStatus | 'all'>('all');
  const [offset, setOffset] = useState(0);

  const { data, meta, isLoading, error, refetch } = usePayouts(activeStatus, offset, PAGE_SIZE);

  const handleStatusChange = (status: PayoutStatus | 'all') => {
    setActiveStatus(status);
    setOffset(0);
  };

  if (profileLoading) return <LoadingSkeleton />;

  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];
  const total = meta?.total ?? 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <RoleGate
      roles={['surewaka_admin']}
      userRoles={userRoles}
      fallback={
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            You do not have permission to view this page.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
          <p className="text-sm text-muted-foreground">
            Monitor withdrawal requests and bank transfer statuses
          </p>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeStatus === s
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Error state */}
        {error && !isLoading && (
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              Retry
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Bank Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transfer Code</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Processed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    No payouts found{activeStatus !== 'all' ? ` with status "${activeStatus}"` : ''}.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.userName}</div>
                      <div className="text-xs text-muted-foreground">{row.userEmail}</div>
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {formatNaira(row.amount / 100)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.accountName}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {row.accountNumber}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {row.failureReason && (
                        <p
                          className="mt-1 max-w-[200px] truncate text-xs text-muted-foreground"
                          title={row.failureReason}
                        >
                          {row.failureReason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.paystackTransferCode ? (
                        <span className="font-mono text-xs">{row.paystackTransferCode}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.processedAt ? formatDate(row.processedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total === 0 ? 'No results' : `${from}–${to} of ${total} payouts`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || isLoading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || isLoading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </RoleGate>
  );
}

// ─── Route Export ─────────────────────────────────────────────────────────────

export default function PayoutsRoute() {
  return (
    <PayoutsErrorBoundary>
      <PayoutsPage />
    </PayoutsErrorBoundary>
  );
}
