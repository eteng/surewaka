import { useState } from 'react';
import { AlertTriangle, CheckCircle, Radio, Timer } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import type { AtRiskDelivery, RiskReason } from '@surewaka/shared';

// ─── Risk reason badge ────────────────────────────────────────────────────────

const RISK_LABELS: Record<RiskReason, { label: string; icon: React.ReactNode; class: string }> = {
  overdue: {
    label: 'Overdue',
    icon: <Timer className="h-3 w-3" aria-hidden="true" />,
    class: 'text-amber-600 dark:text-amber-400',
  },
  driver_silent: {
    label: 'Driver Silent',
    icon: <Radio className="h-3 w-3" aria-hidden="true" />,
    class: 'text-destructive',
  },
  no_update_sent: {
    label: 'No Update Sent',
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
    class: 'text-amber-600 dark:text-amber-400',
  },
};

function RiskBadge({ reason }: { reason: RiskReason }) {
  const { label, icon, class: cls } = RISK_LABELS[reason];
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', cls)}>
      {icon}
      {label}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

type AtRiskListProps = {
  deliveries: AtRiskDelivery[];
  isLoading: boolean;
  onEscalate: (id: string) => void;
};

export function AtRiskList({ deliveries, isLoading, onEscalate }: AtRiskListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleAll = () => {
    if (selected.size === deliveries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deliveries.map((d) => d.id)));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
        <CheckCircle className="h-4 w-4" aria-hidden="true" />
        All deliveries on track
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { selected.forEach((id) => onEscalate(id)); setSelected(new Set()); }}
          >
            Escalate selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={selected.size === deliveries.length && deliveries.length > 0}
                  onChange={toggleAll}
                  aria-label="Select all at-risk deliveries"
                  className="h-4 w-4 rounded border-border accent-primary"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tracking ID</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Driver</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Min Overdue</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Risk</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr
                key={delivery.id}
                className={cn(
                  'border-b border-border last:border-0 transition-colors',
                  selected.has(delivery.id) ? 'bg-muted/40' : 'hover:bg-muted/20',
                )}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(delivery.id)}
                    onChange={() => toggle(delivery.id)}
                    aria-label={`Select delivery ${delivery.trackingId}`}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs font-medium">{delivery.trackingId}</td>
                <td className="px-4 py-3">{delivery.customerName}</td>
                <td className="px-4 py-3 text-muted-foreground">{delivery.driverName ?? '—'}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">
                  {delivery.status.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {delivery.minutesOverdue > 0 ? `${delivery.minutesOverdue} min` : '—'}
                </td>
                <td className="px-4 py-3">
                  <RiskBadge reason={delivery.riskReason} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEscalate(delivery.id)}
                    aria-label={`Escalate delivery ${delivery.trackingId}`}
                  >
                    Escalate
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
