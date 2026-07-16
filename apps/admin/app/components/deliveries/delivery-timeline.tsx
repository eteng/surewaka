import { AlertCircle } from 'lucide-react';
import type { DeliveryEventWithActor, DeliveryStatus } from '@surewaka/shared';
import { cn } from '~/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatStatus(status: DeliveryStatus): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) return formatTime(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + formatTime(dateStr);
}

const FAILURE_CAUSE_LABELS: Record<string, string> = {
  driver: 'Driver issue',
  carrier: 'Carrier issue',
  route_traffic: 'Traffic / route',
  system: 'System error',
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3 pb-4">
          <div className="flex flex-col items-center">
            <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-muted" />
            {i < 3 && <div className="mt-1 min-h-8 w-px flex-1 bg-border" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 pb-0.5">
            <div className="flex items-baseline gap-2">
              <div className="h-4 w-28 rounded bg-muted" />
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-3 w-12 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Single event row ─────────────────────────────────────────────────────────

type EventRowProps = {
  event: DeliveryEventWithActor;
  isLast: boolean;
};

function EventRow({ event, isLast }: EventRowProps) {
  const isFailure = event.failureCause !== null;

  return (
    <div className="flex gap-3">
      {/* Connector column */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2',
            isFailure
              ? 'bg-destructive ring-destructive/20'
              : 'bg-primary ring-primary/20',
          )}
        />
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div className={cn('pb-4 min-w-0', isLast && 'pb-0')}>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-sm font-medium',
              isFailure ? 'text-destructive' : 'text-foreground',
            )}
          >
            {formatStatus(event.toStatus)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatDate(event.createdAt)}</span>
        </div>

        {event.fromStatus && (
          <p className="text-xs text-muted-foreground">
            from <span className="font-medium">{formatStatus(event.fromStatus)}</span>
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {event.actorName ? event.actorName : 'System'}
        </p>

        {isFailure && (
          <div className="mt-1 rounded-md bg-destructive/15 px-2.5 py-1.5 text-xs text-destructive">
            <span className="font-medium">{FAILURE_CAUSE_LABELS[event.failureCause!] ?? event.failureCause}</span>
            {event.failureNote && (
              <span className="text-destructive/80"> — {event.failureNote}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-sm text-muted-foreground">No events recorded yet.</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type DeliveryTimelineProps = {
  events: DeliveryEventWithActor[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
};

export function DeliveryTimeline({ events, loading, error, onRetry }: DeliveryTimelineProps) {
  if (loading) {
    return <TimelineSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (events.length === 0) return <EmptyState />;

  return (
    <div>
      {events.map((event, i) => (
        <EventRow key={event.id} event={event} isLast={i === events.length - 1} />
      ))}
    </div>
  );
}
