import { useAnalyticsCustomerExperience } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

type Props = { params: AnalyticsParams };

export function CustomerExperienceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsCustomerExperience(params);

  if (error) return <p className="text-sm text-destructive">Failed to load customer experience: {error}</p>;
  if (isLoading)
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  if (!data) return null;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-1 text-sm font-semibold">Repeat Booking Rate</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          A large gap between 30-day and 60-day rates indicates customers on a monthly cycle — not churn.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-3xl font-bold text-foreground">{data.repeatRate30d}%</p>
            <p className="mt-1 text-sm text-muted-foreground">30-day window</p>
            <p className="text-xs text-muted-foreground">Frequent shippers</p>
          </div>
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-3xl font-bold text-foreground">{data.repeatRate60d}%</p>
            <p className="mt-1 text-sm text-muted-foreground">60-day window</p>
            <p className="text-xs text-muted-foreground">Monthly SME cycle</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">Customer Update Frequency</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Avg customer-facing status events per delivery. Target: ≥ 3.
        </p>
        {data.updateFrequencyTrend.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this period.</p>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.updateFrequencyTrend}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 6]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, 'Avg updates/delivery']} />
                <ReferenceLine
                  y={3}
                  stroke="#16a34a"
                  strokeDasharray="4 2"
                  label={{ value: 'Target: 3', fontSize: 10, fill: '#16a34a' }}
                />
                <Line type="monotone" dataKey="value" stroke="#0369a1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">Dispute Rate Trend</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          % of deliveries with a recorded failure cause. Target: &lt; 2%.
        </p>
        {data.disputeRateTrend.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this period.</p>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.disputeRateTrend}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 10]} unit="%" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Dispute Rate']} />
                <ReferenceLine
                  y={2}
                  stroke="#dc2626"
                  strokeDasharray="4 2"
                  label={{ value: '2% limit', fontSize: 10, fill: '#dc2626' }}
                />
                <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Avg Dispute Resolution Time</h3>
        <div className="rounded-lg border border-border p-4">
          <p className="text-3xl font-bold text-foreground">{data.avgResolutionHours}h</p>
          <p className="mt-1 text-sm text-muted-foreground">average hours from issue to resolution</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${data.avgResolutionHours <= 24 ? 'bg-green-500' : 'bg-destructive'}`}
              style={{ width: `${Math.min(100, (data.avgResolutionHours / 48) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.avgResolutionHours <= 24
              ? '✓ Within 24-hour target'
              : `⚠ ${(data.avgResolutionHours - 24).toFixed(1)}h over target`}
          </p>
        </div>
      </section>
    </div>
  );
}
