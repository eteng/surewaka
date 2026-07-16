import { useState } from 'react';
import { DollarSign, BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { cn } from '~/lib/utils';
import { Skeleton } from '~/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Button } from '~/components/ui/button';
import { formatNaira } from '~/lib/format';
import { useFinanceSummary, useFinanceTrend, useFinanceLedger } from '~/hooks/use-finance';

export function meta() {
  return [{ title: 'SureWaka Admin - Finance' }];
}

function currentMonthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0]!;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().split('T')[0]!;
  return { from, to };
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
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', negative && 'text-red-600 dark:text-red-400')}>{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs', negative ? 'text-red-500' : 'text-muted-foreground')}>{sub}</p>}
    </div>
  );
}

export default function FinancePage() {
  const { from, to } = currentMonthRange();
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('all');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const PAGE_SIZE = 50;

  const { data: summary, isLoading: summaryLoading } = useFinanceSummary(from, to);
  const { data: trend, isLoading: trendLoading } = useFinanceTrend(6);
  const { data: ledger, total: ledgerTotal, isLoading: ledgerLoading } = useFinanceLedger(
    from, to,
    categoryTab === 'all' ? undefined : categoryTab,
    ledgerOffset,
    PAGE_SIZE,
  );

  const s = summary?.summary;
  const isNegativeMargin = s && s.margin_percent !== null && s.margin_percent < 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">Revenue, expenses, and net profit — current month</p>
      </div>

      {/* Summary cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="Total Revenue" value={formatNaira((s?.revenue ?? 0) / 100)} />
          <SummaryCard label="Total Expenses" value={formatNaira((s?.total_expenses ?? 0) / 100)} />
          <SummaryCard label="Gross Profit" value={formatNaira((s?.gross_profit ?? 0) / 100)} sub="before infrastructure" negative={(s?.gross_profit ?? 0) < 0} />
          <SummaryCard
            label="Net Profit"
            value={formatNaira((s?.net_profit ?? 0) / 100)}
            sub={s?.margin_percent != null ? `${s.margin_percent}% margin` : undefined}
            negative={isNegativeMargin ?? false}
          />
        </div>
      )}

      {/* Breakdown */}
      {!summaryLoading && summary && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Revenue breakdown */}
          <section className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><DollarSign className="h-4 w-4" />Revenue</h2>
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
          <section className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart2 className="h-4 w-4" />Expenses</h2>
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
              {(['vercel', 'fly', 'neon', 'clerk', 'ably'] as const).map((p) => (
                <div key={p} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">
                    {['clerk', 'ably'].includes(p) ? `~${p}` : p}
                  </span>
                  <span className="tabular-nums">{formatNaira(summary.expenses.infrastructure[p] / 100)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatNaira(summary.expenses.total / 100)}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Trend chart */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">6-Month Trend</h2>
        {trendLoading ? (
          <Skeleton className="mt-4 h-52 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={220} className="mt-4">
            <BarChart data={trend} barGap={4}>
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `₦${(v / 100000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: unknown) => formatNaira((v as number) / 100)} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="gross_profit" name="Gross Profit" fill="#4ade80" radius={[3, 3, 0, 0]} />
              <Bar dataKey="net_profit" name="Net Profit" fill="#86efac" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Ledger table */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center gap-1 border-b p-4">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setCategoryTab(tab); setLedgerOffset(0); }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                categoryTab === tab ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
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
          <TableBody>
            {ledgerLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : ledger.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">No ledger entries for this period.</TableCell>
              </TableRow>
            ) : (
              ledger.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground">{new Date(row.occurredAt).toLocaleDateString('en-NG')}</TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', CATEGORY_STYLES[row.category])}>
                      {row.category}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{TYPE_LABELS[row.type] ?? row.type}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNaira(row.amountKobo / 100)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.sourceType}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t p-4">
          <p className="text-sm text-muted-foreground">{ledgerTotal} entries</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={ledgerOffset === 0} onClick={() => setLedgerOffset(Math.max(0, ledgerOffset - PAGE_SIZE))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={ledgerOffset + PAGE_SIZE >= ledgerTotal} onClick={() => setLedgerOffset(ledgerOffset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
