import { Clock, Loader2, ShieldCheck, ShieldX, ArrowUpCircle, FileText } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditLogEntry = {
  id: string;
  action: 'assigned' | 'revoked' | 'upgraded';
  role: string;
  scopeType: string | null;
  scopeId: string | null;
  performedBy: {
    id: string;
    name: string;
  };
  reason: string | null;
  createdAt: string;
};

type AuditMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type AuditHistoryProps = {
  entries: AuditLogEntry[];
  meta: AuditMeta | null;
  isLoading?: boolean;
  onLoadMore?: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; text: string; icon: typeof ShieldCheck }> = {
  assigned: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-800 dark:text-green-300',
    icon: ShieldCheck,
  },
  revoked: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-800 dark:text-red-300',
    icon: ShieldX,
  },
  upgraded: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-800 dark:text-blue-300',
    icon: ArrowUpCircle,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuditHistory({ entries, meta, isLoading, onLoadMore }: AuditHistoryProps) {
  const hasMore = meta ? meta.page < meta.totalPages : false;

  // Loading state
  if (isLoading && entries.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Role Change History</h3>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border p-4">
              <Skeleton className="h-6 w-20 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (!isLoading && entries.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Role Change History</h3>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
          <FileText className="mb-3 size-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No role changes have been recorded
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Role Change History</h3>
        {meta && (
          <span className="text-sm text-muted-foreground">
            {meta.total} {meta.total === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {/* Audit entries */}
      <div className="space-y-3">
        {entries.map((entry) => {
          const actionStyle = ACTION_STYLES[entry.action] ?? ACTION_STYLES.assigned;
          const ActionIcon = actionStyle.icon;

          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              {/* Action badge */}
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                  actionStyle.bg,
                  actionStyle.text,
                )}
              >
                <ActionIcon className="size-3" />
                {entry.action}
              </span>

              {/* Details */}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm">
                  <span className="font-medium">{formatRoleLabel(entry.role)}</span>
                  {entry.scopeType && entry.scopeId && (
                    <span className="text-muted-foreground">
                      {' '}(org-scoped)
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  by {entry.performedBy.name}
                </p>
                {entry.reason && (
                  <p className="text-xs text-muted-foreground italic">
                    &ldquo;{entry.reason}&rdquo;
                  </p>
                )}
              </div>

              {/* Timestamp */}
              <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
              </div>
            </div>
          );
        })}
      </div>

      {/* Load more / pagination */}
      {hasMore && onLoadMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {isLoading ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
