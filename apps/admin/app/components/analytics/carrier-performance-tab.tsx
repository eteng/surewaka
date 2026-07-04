import { useAnalyticsCarrierPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList, ReferenceLine } from 'recharts';

type Props = { params: AnalyticsParams };

export function CarrierPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsCarrierPerformance(params);

  if (error) return <p className="text-sm text-destructive">Failed to load carrier performance: {error}</p>;
  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!data || data.rows.length === 0)
    return <p className="text-sm text-muted-foreground">No carrier data for this period.</p>;

  const { configured, total } = data.overrideCoverage;
  const coveragePct = total > 0 ? Math.round((configured / total) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 rounded-lg border border-border p-4">
        {coveragePct === 100 ? (
          <CheckCircle className="h-5 w-5 text-green-600" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
        )}
        <div>
          <p className="text-sm font-medium">SLA Override Coverage</p>
          <p className="text-xs text-muted-foreground">
            {configured} of {total} carrier-route combinations have a configured SLA override.
            {coveragePct < 100 && ' Remaining routes use the 24-hour default.'}
          </p>
        </div>
        <span className="ml-auto text-lg font-bold">{coveragePct}%</span>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold">SLA Adherence by Carrier</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.rows} layout="vertical">
              <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'SLA Adherence']} />
              <ReferenceLine
                x={90}
                stroke="#16a34a"
                strokeDasharray="4 2"
                label={{ value: '90%', fontSize: 10, fill: '#16a34a' }}
              />
              <Bar dataKey="adherencePct" fill="#16a34a" radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="adherencePct"
                  position="right"
                  formatter={(v: number) => `${v}%`}
                  style={{ fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Fulfillment Rate by Carrier</h3>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...data.rows].sort((a, b) => b.fulfillmentPct - a.fulfillmentPct)} layout="vertical">
              <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Fulfillment Rate']} />
              <Bar dataKey="fulfillmentPct" fill="#0369a1" radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="fulfillmentPct"
                  position="right"
                  formatter={(v: number) => `${v}%`}
                  style={{ fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Average Leg Duration vs SLA</h3>
        <table className="w-full text-sm" aria-label="Carrier SLA comparison table">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Carrier</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Avg Hours</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">SLA Hours</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.carrierId} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right">{r.avgActualHours}h</td>
                <td className="px-3 py-2 text-right">{r.slaHours}h</td>
                <td className="px-3 py-2 text-right">
                  {r.avgActualHours <= r.slaHours ? (
                    <span className="font-medium text-green-600">✓ Within SLA</span>
                  ) : (
                    <span className="font-medium text-destructive">
                      ⚠ Over by {(r.avgActualHours - r.slaHours).toFixed(1)}h
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
