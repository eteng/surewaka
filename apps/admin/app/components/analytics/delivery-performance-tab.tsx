import { useAnalyticsDeliveryPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  BarChart,
  Bar,
  LabelList,
  Cell,
} from 'recharts';

type Props = { params: AnalyticsParams };

const STATUS_COLORS: Record<string, string> = {
  delivered: '#16a34a',
  failed: '#dc2626',
  cancelled: '#6b7280',
  returned: '#f59e0b',
};

export function DeliveryPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsDeliveryPerformance(params);

  if (error) return <p className="mt-4 text-sm text-destructive">Failed to load delivery performance: {error}</p>;

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">On-Time Rate Trend</h3>
        {data.dailyOnTimeRate.length === 0 ? (
          <p className="text-sm text-muted-foreground">No delivery data for this period.</p>
        ) : (
          <>
            <div className="h-52" aria-label="On-time rate trend chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailyOnTimeRate}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'On-Time Rate']} />
                  <ReferenceLine
                    y={80}
                    stroke="#dc2626"
                    strokeDasharray="4 2"
                    label={{ value: '80% target', fontSize: 10, fill: '#dc2626' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload } = props;
                      if (payload.isAnomaly) {
                        return (
                          <circle
                            key={`dot-${cx}`}
                            cx={cx}
                            cy={cy}
                            r={5}
                            fill="#dc2626"
                            stroke="white"
                            strokeWidth={1.5}
                          />
                        );
                      }
                      return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={3} fill="#16a34a" />;
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">View as table</summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left">Date</th>
                    <th className="text-right">Rate (%)</th>
                    <th className="text-right">Anomaly</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyOnTimeRate.map((r) => (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td className="text-right">{r.rate}</td>
                      <td className="text-right">{r.isAnomaly ? '⚠ Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Delivery Volume by Outcome</h3>
        {data.volumeByOutcome.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries in this period.</p>
        ) : (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.volumeByOutcome} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="status" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11 }} />
                  {data.volumeByOutcome.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Phase Breakdown vs SLA</h3>
        {data.phaseBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed legs in this period.</p>
        ) : (
          <div className="space-y-3">
            {data.phaseBreakdown.map((p) => {
              const slaMin = p.slaHours * 60;
              const pct = Math.min(100, (p.avgMinutes / slaMin) * 100);
              const isOver = p.avgMinutes > slaMin;
              return (
                <div key={p.legType}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize">{p.legType.replace('_', ' ')}</span>
                    <span className={isOver ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                      {isOver ? '⚠ ' : ''}
                      {p.avgMinutes} min avg / {slaMin} min SLA
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${isOver ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Late Delivery Distribution</h3>
        {data.lateDistribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">No late deliveries in this period.</p>
        ) : (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.lateDistribution} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="bucket" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
