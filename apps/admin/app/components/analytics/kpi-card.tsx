import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import type { SparkPoint } from '@surewaka/shared';

type Props = {
  label: string;
  value: number | undefined;
  unit?: string;
  sparkline?: SparkPoint[];
  target?: number;
  higherIsBetter?: boolean;
  isLoading?: boolean;
};

export function KpiCard({ label, value, unit = '', sparkline, target, higherIsBetter = true, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-8 w-20" />
        <Skeleton className="mt-2 h-3 w-24" />
      </div>
    );
  }

  const latest = sparkline?.at(-1)?.value;
  const prev = sparkline?.at(-2)?.value;
  const delta = latest !== undefined && prev !== undefined ? latest - prev : undefined;
  const isGood = delta === undefined ? null : higherIsBetter ? delta >= 0 : delta <= 0;
  const isBelowTarget =
    target !== undefined && value !== undefined && (higherIsBetter ? value < target : value > target);

  return (
    <div className={cn('rounded-lg border p-4', isBelowTarget ? 'border-destructive/50 bg-destructive/5' : 'border-border')}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold text-foreground">
        {value !== undefined ? `${value}${unit}` : '—'}
      </p>
      {delta !== undefined && (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-xs font-medium',
            isGood ? 'text-green-600 dark:text-green-400' : 'text-destructive',
          )}
        >
          {isGood === null ? (
            <Minus className="h-3 w-3" />
          ) : isGood ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span>
            {isGood ? '+' : ''}
            {delta.toFixed(1)}
            {unit} vs prev
          </span>
        </p>
      )}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-3 h-12" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkline}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={isBelowTarget ? 'var(--color-destructive)' : 'var(--color-primary)'}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
