import { useState } from 'react';
import { useAnalyticsRootCause, type RootCauseFilters } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { LAGOS_ZONES } from '@surewaka/shared';
import { cn } from '~/lib/utils';

const CAUSE_COLORS: Record<string, string> = {
  driver: '#f59e0b',
  carrier: '#0369a1',
  route_traffic: '#6b7280',
  system: '#dc2626',
};

const TIME_SLOTS = ['morning', 'midday', 'evening', 'night'] as const;

type Props = { params: AnalyticsParams };

export function RootCauseTab({ params }: Props) {
  const [filters, setFilters] = useState<RootCauseFilters>({});
  const { data, isLoading, error } = useAnalyticsRootCause({ ...params, ...filters });

  const setFilter = (key: keyof RootCauseFilters, value: string | undefined) =>
    setFilters((f) => ({ ...f, [key]: value === 'all' ? undefined : value || undefined }));

  const heatCells = data?.heatmap ?? [];
  const maxDelay = Math.max(...heatCells.map((c) => c.avgDelayMinutes), 1);

  if (error) return <p className="text-sm text-destructive">Failed to load root cause data: {error}</p>;

  return (
    <div className="flex gap-6">
      <aside className="w-52 shrink-0 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Lagos Zone</label>
          <Select value={filters.zone ?? 'all'} onValueChange={(v) => setFilter('zone', v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter by Lagos zone">
              <SelectValue placeholder="All zones" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              {LAGOS_ZONES.map((z) => (
                <SelectItem key={z} value={z}>
                  {z}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Leg Type</label>
          <Select value={filters.legType ?? 'all'} onValueChange={(v) => setFilter('legType', v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter by leg type">
              <SelectValue placeholder="All leg types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All leg types</SelectItem>
              <SelectItem value="first_mile">First Mile</SelectItem>
              <SelectItem value="intercity">Intercity</SelectItem>
              <SelectItem value="last_mile">Last Mile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Time of Day</label>
          <Select value={filters.timeOfDay ?? 'all'} onValueChange={(v) => setFilter('timeOfDay', v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter by time of day">
              <SelectValue placeholder="All hours" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All hours</SelectItem>
              <SelectItem value="morning">Morning (6–10am)</SelectItem>
              <SelectItem value="midday">Midday (10am–3pm)</SelectItem>
              <SelectItem value="evening">Evening rush (3–7pm)</SelectItem>
              <SelectItem value="night">Night (7pm–6am)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-8">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        ) : !data ? null : (
          <>
            <section>
              <h3 className="mb-3 text-sm font-semibold">Failure Decomposition</h3>
              {data.failureDecomposition.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No failures recorded for this filter combination.
                </p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.failureDecomposition}
                          dataKey="count"
                          nameKey="cause"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          innerRadius={40}
                        >
                          {data.failureDecomposition.map((entry) => (
                            <Cell key={entry.cause} fill={CAUSE_COLORS[entry.cause] ?? '#6b7280'} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, name: string) => [v, name]} />
                        <Legend formatter={(v) => v.replace('_', ' ')} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">View as table</summary>
                    <table className="mt-2 w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Cause</th>
                          <th className="text-right">Count</th>
                          <th className="text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.failureDecomposition.map((r) => (
                          <tr key={r.cause}>
                            <td className="capitalize">{r.cause.replace('_', ' ')}</td>
                            <td className="text-right">{r.count}</td>
                            <td className="text-right">{r.pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold">Top Contributors to Delay</h3>
              {data.topContributors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No late deliveries for this filter.</p>
              ) : (
                <ol className="space-y-2">
                  {data.topContributors.map((c, i) => (
                    <li key={c.actorId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <span className="w-5 shrink-0 text-lg font-bold text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="text-xs capitalize text-muted-foreground">{c.actorType}</p>
                        <p className="mt-1 text-xs">
                          <span className="font-medium text-destructive">{c.lateCount} late deliveries</span>
                          {' · '}avg {c.avgMinutesLate} min late{' · '}mostly {c.topZone}
                          {' · '}
                          {c.topTimeOfDay}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold">Delay Heatmap — Time of Day × Zone</h3>
              {heatCells.length === 0 ? (
                <p className="text-sm text-muted-foreground">No delay data for this filter.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table
                      className="w-full border-collapse text-xs"
                      aria-label="Delay heatmap by time of day and zone"
                    >
                      <thead>
                        <tr>
                          <th className="py-1 pr-3 text-left font-medium text-muted-foreground">Time of Day</th>
                          {LAGOS_ZONES.slice(0, 6).map((z) => (
                            <th
                              key={z}
                              className="whitespace-nowrap px-2 py-1 text-center font-medium text-muted-foreground"
                            >
                              {z}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {TIME_SLOTS.map((slot) => (
                          <tr key={slot}>
                            <td className="py-1 pr-3 font-medium capitalize">{slot}</td>
                            {LAGOS_ZONES.slice(0, 6).map((zone) => {
                              const cell = heatCells.find((c) => c.zone === zone && c.timeOfDay === slot);
                              const delay = cell?.avgDelayMinutes ?? 0;
                              const intensity = delay / maxDelay;
                              return (
                                <td key={zone} className="px-2 py-1 text-center" title={`${delay} min avg delay`}>
                                  <span
                                    className={cn(
                                      'inline-block rounded px-2 py-0.5 font-mono',
                                      delay === 0
                                        ? 'text-muted-foreground'
                                        : intensity > 0.66
                                          ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                          : intensity > 0.33
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                            : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
                                    )}
                                  >
                                    {delay > 0 ? `${delay}m` : '—'}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Higher values = more average delay minutes. Red = worst, green = best.
                  </p>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
