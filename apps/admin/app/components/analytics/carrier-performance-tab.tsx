import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { useAnalyticsCarrierPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  ReferenceLine,
} from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// --- Types ---

type CarrierOption = { id: string; name: string };

type ReconciliationRecord = {
  id: string;
  carrierId: string;
  periodStart: string;
  periodEnd: string;
  invoicedAmountKobo: number;
  quotedCarrierTotalKobo: number;
  varianceKobo: number;
  enteredBy: string | null;
  notes: string | null;
  createdAt: string;
};

type Props = { params: AnalyticsParams };

// --- Helpers ---

function formatKoboToNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// --- Hooks ---

function useCarrierOptions() {
  const { getToken } = useAuth();
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchCarriers() {
      setIsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/v1/carriers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            setCarriers(
              (json.data ?? []).map((c: { id: string; name: string }) => ({
                id: c.id,
                name: c.name,
              })),
            );
          }
        }
      } catch {
        // silently ignore — carriers dropdown will just be empty
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchCarriers();
    return () => { cancelled = true; };
  }, []);

  return { carriers, isLoading };
}

function useReconciliations(filterCarrierId: string) {
  const { getToken } = useAuth();
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function fetchReconciliations() {
      try {
        const token = await getToken();
        if (!token) { setError('Not authenticated'); return; }
        const qs = filterCarrierId ? `?carrier_id=${filterCarrierId}` : '';
        const res = await fetch(
          `${API_URL}/api/v1/admin/carrier-reconciliations${qs}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (!cancelled) setError(body?.error?.message ?? `Request failed: ${res.status}`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setRecords(body.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchReconciliations();
    return () => { cancelled = true; };
  }, [filterCarrierId, tick]);

  return { records, isLoading, error, refetch };
}

// --- Reconciliation Entry Form ---

function ReconciliationForm({
  carriers,
  isLoadingCarriers,
  onSuccess,
}: {
  carriers: CarrierOption[];
  isLoadingCarriers: boolean;
  onSuccess: () => void;
}) {
  const { getToken } = useAuth();
  const [carrierId, setCarrierId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [invoicedNaira, setInvoicedNaira] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!carrierId) { setFormError('Please select a carrier.'); return; }
    if (!periodStart) { setFormError('Period start date is required.'); return; }
    if (!periodEnd) { setFormError('Period end date is required.'); return; }
    if (periodEnd <= periodStart) { setFormError('Period end must be after period start.'); return; }

    const invoicedAmountKobo = Math.round(parseFloat(invoicedNaira) * 100);
    if (isNaN(invoicedAmountKobo) || invoicedAmountKobo < 0) {
      setFormError('Invoiced amount must be a valid positive number.');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/carrier-reconciliations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier_id: carrierId,
          period_start: periodStart,
          period_end: periodEnd,
          invoiced_amount_kobo: invoicedAmountKobo,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.error?.message ?? 'Failed to create reconciliation entry.');
        return;
      }

      // Reset form on success
      setCarrierId('');
      setPeriodStart('');
      setPeriodEnd('');
      setInvoicedNaira('');
      setNotes('');
      onSuccess();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border p-4">
      <h4 className="text-sm font-semibold">New Reconciliation Entry</h4>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="recon-carrier">Carrier</Label>
          {isLoadingCarriers ? (
            <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <Select value={carrierId} onValueChange={setCarrierId}>
              <SelectTrigger id="recon-carrier">
                <SelectValue placeholder="Select carrier" />
              </SelectTrigger>
              <SelectContent>
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-period-start">Period Start</Label>
          <Input
            id="recon-period-start"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-period-end">Period End</Label>
          <Input
            id="recon-period-end"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-invoiced">Invoiced Amount (₦)</Label>
          <Input
            id="recon-invoiced"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 150000"
            value={invoicedNaira}
            onChange={(e) => setInvoicedNaira(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recon-notes">Notes (optional)</Label>
        <textarea
          id="recon-notes"
          className="h-20 w-full min-w-0 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
          placeholder="Invoice reference, context, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {formError && (
        <p className="text-sm text-destructive">{formError}</p>
      )}

      <Button type="submit" disabled={isSubmitting} size="sm">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Submit Reconciliation
      </Button>
    </form>
  );
}

// --- Reconciliation Table ---

function ReconciliationTable({
  records,
  isLoading,
  error,
  carriers,
  filterCarrierId,
  onFilterChange,
  onRetry,
}: {
  records: ReconciliationRecord[];
  isLoading: boolean;
  error: string | null;
  carriers: CarrierOption[];
  filterCarrierId: string;
  onFilterChange: (carrierId: string) => void;
  onRetry: () => void;
}) {
  const carrierMap = new Map(carriers.map((c) => [c.id, c.name]));

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Label htmlFor="recon-filter" className="text-xs text-muted-foreground whitespace-nowrap">
          Filter by carrier:
        </Label>
        <Select value={filterCarrierId} onValueChange={onFilterChange}>
          <SelectTrigger id="recon-filter" className="w-48">
            <SelectValue placeholder="All carriers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All carriers</SelectItem>
            {carriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : records.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No reconciliation records yet. Use the form above to enter one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Carrier margin reconciliation table">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Carrier</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Period</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Invoiced</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Quoted Total</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Variance</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Net</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Notes</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date Entered</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                // variance = quoted_carrier_total - invoiced_amount
                // Positive variance means SureWaka quoted more than the carrier invoiced (profit)
                // Net here equals variance (the margin SureWaka kept or lost)
                const net = r.varianceKobo;

                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      {carrierMap.get(r.carrierId) ?? r.carrierId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatKoboToNaira(r.invoicedAmountKobo)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatKoboToNaira(r.quotedCarrierTotalKobo)}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      r.varianceKobo > 0
                        ? 'text-green-600'
                        : r.varianceKobo < 0
                          ? 'text-destructive'
                          : ''
                    }`}>
                      {r.varianceKobo > 0 ? '+' : ''}
                      {formatKoboToNaira(r.varianceKobo)}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      net > 0 ? 'text-green-600' : net < 0 ? 'text-destructive' : ''
                    }`}>
                      {net > 0 ? '+' : ''}{formatKoboToNaira(net)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">
                      {r.notes ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function CarrierPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsCarrierPerformance(params);
  const { carriers, isLoading: isLoadingCarriers } = useCarrierOptions();
  const [filterCarrierId, setFilterCarrierId] = useState('');

  const effectiveFilter = filterCarrierId === 'all' ? '' : filterCarrierId;
  const {
    records,
    isLoading: isLoadingReconciliations,
    error: reconciliationError,
    refetch: refetchReconciliations,
  } = useReconciliations(effectiveFilter);

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
            <BarChart
              data={[...data.rows].sort((a, b) => b.fulfillmentPct - a.fulfillmentPct)}
              layout="vertical"
            >
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

      {/* --- Margin Reconciliation Section --- */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Margin Reconciliation</h3>

        <ReconciliationForm
          carriers={carriers}
          isLoadingCarriers={isLoadingCarriers}
          onSuccess={refetchReconciliations}
        />

        <ReconciliationTable
          records={records}
          isLoading={isLoadingReconciliations}
          error={reconciliationError}
          carriers={carriers}
          filterCarrierId={filterCarrierId || 'all'}
          onFilterChange={(val) => setFilterCarrierId(val === 'all' ? '' : val)}
          onRetry={refetchReconciliations}
        />
      </section>
    </div>
  );
}
