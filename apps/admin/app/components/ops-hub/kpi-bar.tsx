import { AlertTriangle, Car, Clock, MessageCircleWarning, Package } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import type { OpsHubStats } from '@surewaka/shared';

type KpiCardProps = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isAlert?: boolean;
  subLabel?: string;
};

function KpiCard({ label, value, icon, isAlert = false, subLabel }: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-5 transition-colors',
        isAlert ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-card',
      )}
    >
      <div className={cn('flex items-center gap-2 text-sm font-medium', isAlert ? 'text-destructive' : 'text-muted-foreground')}>
        {icon}
        {label}
      </div>
      <p className={cn('mt-2 text-3xl font-bold tabular-nums', isAlert ? 'text-destructive' : 'text-foreground')}>
        {value}
      </p>
      {subLabel && <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p>}
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="mt-2 h-9 w-16" />
      <Skeleton className="mt-1 h-3 w-24" />
    </div>
  );
}

type KpiBarProps = {
  stats: OpsHubStats | null;
  isLoading: boolean;
  error: string | null;
};

export function KpiBar({ stats, isLoading, error }: KpiBarProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />
        Failed to load live stats: {error}
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        label="Active Deliveries"
        value={stats.activeDeliveries.toLocaleString()}
        icon={<Package className="h-4 w-4" aria-hidden="true" />}
      />
      <KpiCard
        label="Drivers On Duty"
        value={stats.driversOnDuty.toLocaleString()}
        icon={<Car className="h-4 w-4" aria-hidden="true" />}
        subLabel={`${stats.driversAvailable} available`}
      />
      <KpiCard
        label="At-Risk Deliveries"
        value={stats.atRiskDeliveries > 0 ? `⚠ ${stats.atRiskDeliveries} at risk` : '0'}
        icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        isAlert={stats.atRiskDeliveries > 0}
      />
      <KpiCard
        label="Open Disputes"
        value={stats.openDisputes > 0 ? `⚠ ${stats.openDisputes} open` : '0'}
        icon={<MessageCircleWarning className="h-4 w-4" aria-hidden="true" />}
        isAlert={stats.openDisputes > 0}
      />
      <KpiCard
        label="On-Time Rate Today"
        value={stats.onTimeRateToday != null ? `${stats.onTimeRateToday.toFixed(1)}%` : '—'}
        icon={<Clock className="h-4 w-4" aria-hidden="true" />}
        isAlert={stats.onTimeRateToday != null && stats.onTimeRateToday < 80}
        subLabel={stats.onTimeRateToday != null && stats.onTimeRateToday < 80 ? '⚠ Below 80% target' : undefined}
      />
    </div>
  );
}
