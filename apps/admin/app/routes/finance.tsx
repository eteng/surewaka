import { useState } from 'react';
import { DollarSign, BarChart2, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { cn } from '~/lib/utils';
import { Skeleton } from '~/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Button } from '~/components/ui/button';
import { formatNaira } from '~/lib/format';
import { useFinanceSummary, useFinanceTrend, useFinanceLedger } from '~/hooks/use-finance';

export function meta() {
  return [{ title: 'SureWaka Admin - Finance' }];
}

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month, 1)).toISOString().split('T')[0]!;
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().split('T')[0]!;
  return { from, to };
}

function formatMonthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

const CATEGORY_TABS = ['all', 'revenue', 'expense'] as const;
type CategoryTab = (typeof CATEGORY_TABS)[number];

const TYPE_LABELS: Record<string, string> = {
  commission: 'Commission',
  withdrawal_fee: 'Withdrawal Fee',
  paystack_transfer: 'Paystack Transfer',
  paystack_collection: 'Paystack Collection',
  commission_reversal: 'Commission Reversal',
};

const CATEGORY_STYLES: Record<string, string> = {
  revenue: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expense: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function SummaryCard({ label, value, sub, negative }: { label: string; value: string; sub?: string; negative?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-bold tabular-nums lg:text-2xl', negative && 'text-red-600 dark:text-red-400')}>{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs', negative ? 'text-red-500' : 'text-muted-foreground')}>{sub}</p>}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}

export default function FinancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('all');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const PAGE_SIZE = 50;

  const { from, to } = monthRange(year, month);
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setLedgerOffset(0);
  }

  function nextMonth() {
    if (isCurrentMonth) return;
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setLedgerOffset(0);
  }

  const { data: summary, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useFinanceSummary(from, to);
  const { data: trend, isLoading: trendLoading, error: trendError } = useFinanceTrend(6);
  const { data: ledger, total: ledgerTotal, isLoading: ledgerLoading, error: ledgerError, refetch: refetchLedger } = useFinanceLedger(
    from, to,
    categoryTab === 'all' ? undefined : categoryTab,
    ledgerOffset,
    PAGE_SIZE,
  );

  const s = summary?.summary;
  const isNegativeMargin = s && s.margin_percent !== null && s.margin_percent < 0;

  const ledgerStart = ledgerTotal === 0 ? 0 : ledgerOffset + 1;
  const ledgerEnd = Math.min(ledgerOffset + PAGE_SIZE, ledgerTotal);

  return (
    <div className="flex flex-col gap-6">
      {/* Header with month navigator */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground">Revenue, expenses, and net profit</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[148px] text-center text-sm font-medium">{formatMonthLabel(year, month)}</span>
          <Button variant="outline" size="icon" onClick={nextMonth} disabled={isCurrentMonth} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : summaryError ? (
        <div className="rounded-xl border bg-card p-5">
          <ErrorState message={`Failed to load summary: ${summaryError}`} onRetry={refetchSummary} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="Total Revenue" value={formatNaira((s?.revenue ?? 0) / 100)} />
          <SummaryCard label="Total Expenses" value={formatNaira((s?.total_expenses ?? 0) / 100)} />
          <SummaryCard label="Gross Profit" value={formatNaira((s?.gross_profit ?? 0) / 100)} sub="before infrastructure" negative={(s?.gross_profit ?? 0) < 0} />
          <SummaryCard
            label="Net Profit"
            value={formatNaira((s?.net_profit ?? 0) / 100)}
            sub={s?.margin_percent != null ? `${s.margin_percent.toFixed(1)}% margin` : undefined}
            negative={isNegativeMargin ?? false}
          />
        </div>
      )}

      {/* Breakdown */}
      {!summaryLoading && !summaryError && summary && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Revenue breakdown */}
          <section className="rounded-xl border bg-card p-5" aria-label="Revenue breakdown">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <DollarSign className="h-4 w-4" aria-hidden="true" />Revenue
            </h3>
            <div className="mt-4 space-y-2">
              {[
                { label: 'Commission', value: summary.revenue.commission },
                { label: 'Withdrawal Fees', value: summary.revenue.withdrawal_fees },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium tabular-nums">{formatNaira(item.value / 100)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatNaira(summary.revenue.total / 100)}</span>
              </div>
            </div>
          </section>

          {/* Expense breakdown */}
          <section className="rounded-xl border bg-card p-5" aria-label="Expense breakdown">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <BarChart2 className="h-4 w-4" aria-hidden="true" />Expenses
            </h3>
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Operational</p>
              {[
                { label: 'Paystack Transfer', value: summary.expenses.operational.paystack_transfer },
                { label: 'Paystack Collection', value: summary.expenses.operational.paystack_collection },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="tabular-nums">{formatNaira(item.value / 100)}</span>
                </div>
              ))}
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Infrastructure</p>
              {(['vercel', 'fly', 'neon', 'clerk', 'ably'] as const).map((p) => {
                const isEstimated = p === 'clerk' || p === 'ably';
                return (
                  <div key={p} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground capitalize">
                      {p}
                      {isEstimated && (
                        <Info
                          className="h-3 w-3 shrink-0 text-muted-foreground/60"
                          aria-hidden="true"
                          title="Estimated — exact API billing data unavailable"
                        />
                      )}
                    </span>
                    <span className="tabular-nums">{formatNaira(summary.expenses.infrastructure[p] / 100)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatNaira(summary.expenses.total / 100)}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Trend chart */}
      <section className="rounded-xl border bg-card p-5" aria-label="6-month revenue trend">
        <h3 className="text-sm font-semibold">6-Month Trend</h3>
        {trendLoading ? (
          <Skeleton className="mt-4 h-52 w-full" />
        ) : trendError ? (
          <ErrorState message={`Failed to load trend: ${trendError}`} />
        ) : trend.length === 0 ? (
          <div className="flex h-52 items-center justify-center">
            <p className="text-sm text-muted-foreground">No trend data yet.</p>
          </div>
        ) : (
          <div role="img" aria-label="Line chart showing revenue, gross profit, and net profit over the last 6 months">
            <ResponsiveContainer width="100%" height={220} className="mt-4">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v: number) => `₦${(v / 100000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown) => formatNaira((v as number) / 100)} />
                <Legend />
                <Line dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line dataKey="gross_profit" name="Gross Profit" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line dataKey="net_profit" name="Net Profit" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Ledger table */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center gap-1 border-b p-4" role="tablist" aria-label="Filter ledger by category">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={categoryTab === tab}
              onClick={() => { setCategoryTab(tab); setLedgerOffset(0); }}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                categoryTab === tab ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {ledgerError ? (
          <div className="p-6">
            <ErrorState message={`Failed to load ledger: ${ledgerError}`} onRetry={refetchLedger} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={cn('transition-opacity duration-150', ledgerLoading && 'opacity-50 pointer-events-none')}>
                {ledgerLoading && ledger.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : ledger.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                      No ledger entries for this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  ledger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(row.occurredAt).toLocaleDateString('en-NG')}
                      </TableCell>
                      <TableCell>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', CATEGORY_STYLES[row.category])}>
                          {row.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{TYPE_LABELS[row.type] ?? row.type}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatNaira(row.amountKobo / 100)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground" title={row.sourceId}>
                        {row.sourceType}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between border-t p-4">
          <p className="text-sm text-muted-foreground">
            {ledgerTotal === 0 ? '0 entries' : `${ledgerStart}–${ledgerEnd} of ${ledgerTotal}`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={ledgerOffset === 0 || ledgerLoading}
              onClick={() => setLedgerOffset(Math.max(0, ledgerOffset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={ledgerOffset + PAGE_SIZE >= ledgerTotal || ledgerLoading}
              onClick={() => setLedgerOffset(ledgerOffset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
