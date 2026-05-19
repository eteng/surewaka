import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { columns } from '~/components/waitlist/columns';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';

type WaitlistSignupRecord = {
  id: string;
  fullName: string;
  email: string;
  userType: 'sender' | 'business' | 'driver';
  source: string;
  createdAt: string;
};

type WaitlistDataTableProps = {
  data: WaitlistSignupRecord[];
  pageCount: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (column: string) => void;
};

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b">
          {columns.map((_, colIndex) => (
            <td key={colIndex} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function WaitlistDataTable({
  data,
  pageCount,
  isLoading,
  error,
  onRetry,
  sortBy,
  sortDir,
  onSortChange,
}: WaitlistDataTableProps) {
  // Map sortBy/sortDir to TanStack sorting state for display purposes
  const sorting: SortingState = sortBy
    ? [{ id: sortBy, desc: sortDir === 'desc' }]
    : [];

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      sorting,
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16">
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b bg-muted/50">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const isActive = sortBy === header.column.id;

                return (
                  <th
                    key={header.id}
                    className={`px-4 py-3 text-left font-medium text-muted-foreground ${
                      canSort ? 'cursor-pointer select-none' : ''
                    }`}
                    onClick={canSort ? () => onSortChange(header.column.id) : undefined}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {isActive &&
                        (sortDir === 'asc' ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        ))}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows />
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-16 text-center text-sm text-muted-foreground"
              >
                No results found
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b transition-colors hover:bg-muted/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
