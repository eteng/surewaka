import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { columns } from '~/components/customers/customer-columns';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import type { CustomerListItem } from '@surewaka/shared';

type CustomerDataTableProps = {
  data: CustomerListItem[];
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
      {Array.from({ length: 8 }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b">
          {/* Avatar + name */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </td>
          {/* Phone */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-28" />
          </td>
          {/* Email */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </td>
          {/* Deliveries */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-8" />
          </td>
          {/* Total Spent */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-20" />
          </td>
          {/* Last Active */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-16" />
          </td>
          {/* Tier */}
          <td className="px-4 py-3">
            <Skeleton className="h-5 w-14 rounded-full" />
          </td>
          {/* Verified */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-4 rounded-full" />
          </td>
          {/* Joined */}
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-20" />
          </td>
        </tr>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <tr>
      <td colSpan={columns.length} className="py-16">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">No customers found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try adjusting your search or filter criteria
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function CustomerDataTable({
  data,
  pageCount,
  isLoading,
  error,
  onRetry,
  sortBy,
  sortDir,
  onSortChange,
}: CustomerDataTableProps) {
  const navigate = useNavigate();

  const sorting: SortingState = sortBy ? [{ id: sortBy, desc: sortDir === 'desc' }] : [];

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: { sorting },
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
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm" role="grid" aria-label="Customer listing">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b bg-muted/50">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const isActive = sortBy === header.column.id;

                return (
                  <th
                    key={header.id}
                    className={`whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground ${
                      canSort
                        ? 'cursor-pointer select-none transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                        : ''
                    }`}
                    onClick={canSort ? () => onSortChange(header.column.id) : undefined}
                    onKeyDown={
                      canSort
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSortChange(header.column.id);
                            }
                          }
                        : undefined
                    }
                    tabIndex={canSort ? 0 : undefined}
                    role={canSort ? 'columnheader button' : 'columnheader'}
                    aria-sort={
                      isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {isActive &&
                        (sortDir === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
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
            <EmptyState />
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => navigate(`/customers/${row.original.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/customers/${row.original.id}`);
                  }
                }}
                tabIndex={0}
                role="row"
                aria-label={`Customer: ${row.original.name}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap px-4 py-3">
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
