import type { CustomerDetail } from '@surewaka/shared';
import { Card, CardHeader, CardTitle, CardContent } from '~/components/ui/card';
import { formatNaira } from '~/lib/format';
import { formatRelativeTime } from '~/lib/format-relative-time';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHealthScoreColor(score: number): { text: string; label: string } {
  if (score >= 70) return { text: 'text-green-600 dark:text-green-400', label: 'Healthy' };
  if (score >= 40) return { text: 'text-yellow-600 dark:text-yellow-400', label: 'At Risk' };
  return { text: 'text-red-600 dark:text-red-400', label: 'Critical' };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StatCards({ customer }: { customer: CustomerDetail }) {
  const healthColor = getHealthScoreColor(customer.healthScore);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Deliveries
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold tabular-nums">{customer.totalDeliveries}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Spent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold tabular-nums">
            {formatNaira(customer.totalSpent / 100)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Health Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold tabular-nums">{customer.healthScore}/100</p>
          <span className={`text-xs font-medium ${healthColor.text}`}>
            ● {healthColor.label}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Last Active
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {customer.lastDeliveryAt ? formatRelativeTime(customer.lastDeliveryAt) : '—'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
