import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { useAnalyticsDriverPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import type { DriverPerformanceRow } from '@surewaka/shared';
import { cn } from '~/lib/utils';

const col = createColumnHelper<DriverPerformanceRow>();

const columns = [
  col.accessor('name', {
    header: 'Driver',
    cell: (i) => <span className="font-medium">{i.getValue()}</span>,
  }),
  col.accessor('totalLegs', { header: 'Legs' }),
  col.accessor('onTimePct', { header: 'On-Time %', cell: (i) => `${i.getValue()}%` }),
  col.accessor('completionPct', { header: 'Completion %', cell: (i) => `${i.getValue()}%` }),
  col.accessor('ghostRate', {
    header: 'Ghost Rate',
    cell: (i) => {
      const v = i.getValue();
      return (
        <span className={v > 5 ? 'font-medium text-destructive' : ''}>
          {v > 5 ? '⚠ ' : ''}
          {v}%
        </span>
      );
    },
  }),
  col.accessor('avgRating', { header: 'Avg Rating', cell: (i) => `${i.getValue()} / 5` }),
  col.accessor('reliabilityScore', {
    header: 'Reliability',
    cell: (i) => {
      const v = i.getValue();
      return (
        <span
          className={cn(
            'font-bold',
            v >= 80 ? 'text-green-600' : v >= 60 ? 'text-amber-600' : 'text-destructive',
          )}
        >
          {v}
        </span>
      );
    },
  }),
];

type Props = { params: AnalyticsParams };

export function DriverPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsDriverPerformance(params);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'reliabilityScore', desc: true }]);

  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (error) return <p className="text-sm text-destructive">Failed to load driver performance: {error}</p>;
  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No driver data for this period.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm" aria-label="Driver performance table">
        <thead className="bg-muted/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="cursor-pointer select-none px-4 py-3 text-left font-medium text-muted-foreground"
                  onClick={h.column.getToggleSortingHandler()}
                  aria-sort={
                    h.column.getIsSorted() === 'asc'
                      ? 'ascending'
                      : h.column.getIsSorted() === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                >
                  <span className="flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc' ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : h.column.getIsSorted() === 'desc' ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-border hover:bg-muted/30">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
