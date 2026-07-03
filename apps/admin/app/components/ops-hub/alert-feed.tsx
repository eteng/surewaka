import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertTriangle, Bell, CheckCircle, Info } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import type { AlertItem, AlertSeverity } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 30_000;

// ─── Severity config ──────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<AlertSeverity, { icon: React.ReactNode; class: string }> = {
  info: {
    icon: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
    class: 'text-muted-foreground',
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
    class: 'text-amber-600 dark:text-amber-400',
  },
  critical: {
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
    class: 'text-destructive font-semibold',
  },
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: AlertItem }) {
  const config = SEVERITY_CONFIG[alert.severity];
  return (
    <div className={cn('flex gap-3 rounded-lg border border-border p-3', alert.severity === 'critical' && 'border-destructive/40 bg-destructive/5')}>
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', config.class)}>
        {config.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-start justify-between gap-2 text-sm', config.class)}>
          <span>{alert.message}</span>
          <span className="shrink-0 text-xs text-muted-foreground font-normal">{relativeTime(alert.firedAt)}</span>
        </div>
        {alert.deliveryTrackingId && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Delivery{' '}
            <a
              href={`/deliveries?id=${alert.deliveryId}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              #{alert.deliveryTrackingId}
            </a>
            {alert.actorName && ` · ${alert.actorName}`}
          </p>
        )}
        {alert.originalSeverity && alert.originalSeverity !== alert.severity && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Escalated from {alert.originalSeverity}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export function AlertFeed() {
  const { getToken } = useAuth();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: AlertItem[] };
      setAlerts(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchAlerts();
    intervalRef.current = setInterval(() => { void fetchAlerts(); }, POLL_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAlerts]);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Alert Feed</h2>
          {criticalCount > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-xs font-bold text-destructive-foreground">
              {criticalCount} critical
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchAlerts()} aria-label="Refresh alerts">
          Refresh
        </Button>
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Live alert feed"
        className="flex-1 space-y-2 overflow-y-auto"
      >
        {isLoading && (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-sm text-destructive" role="alert">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        )}

        {!isLoading && !error && alerts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <CheckCircle className="h-8 w-8 text-green-500" aria-hidden="true" />
            <p>No active alerts</p>
            <p className="text-xs">Alert engine activates in Spec 3</p>
          </div>
        )}

        {!isLoading && !error && alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </div>
    </div>
  );
}
