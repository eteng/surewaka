import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown, AlertCircle, Package } from 'lucide-react';
import type { DeliveryListItem, DeliveryStatus } from '@surewaka/shared';
import { cn } from '~/lib/utils';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import type { DeliveryTab } from './lifecycle-tab-bar';

export type SortBy = 'createdAt' | 'status' | 'customerName' | 'price';
export type SortDir = 'asc' | 'desc';

type DeliveryDataTableProps = {
  data: DeliveryListItem[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  sortBy: SortBy;
  sortDir: SortDir;
  onSortChange: (column: SortBy) => void;
  onRowClick: (deliveryId: string) => void;
  activeTab?: DeliveryTab;
  selectedDeliveryId?: string | null;
};

// ─── Status Badge Configuration ────────────────────────────────────────────────

const statusBadgeStyles: Record<DeliveryStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  accepted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  en_route_pickup: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  arrived_pickup: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  picked_up: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  en_route_dropoff: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  arrived_dropoff: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  returned: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

const statusLabels: Record<DeliveryStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  accepted: 'Accepted',
  en_route_pickup: 'En Route (Pickup)',
  arrived_pickup: 'At Pickup',
  picked_up: 'Picked Up',
  en_route_dropoff: 'En Route (Dropoff)',
  arrived_dropoff: 'At Dropoff',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
  returned: 'Returned',
};

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Formats elapsed time since creation.
 * < 24h: "Xh Ym"
 * >= 24h: "Xd Yh"
 */
export function formatElapsedTime(createdAt: string): string {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffMs = Math.max(0, now - created);
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return `${totalHours}h ${minutes}m`;
  }

  const remainingHours = totalHours % 24;
  return `${totalDays}d ${remainingHours}h`;
}

function formatPrice(price: number | null): string {
  if (price === null) return '—';
  return `₦${price.toLocaleString('en-NG')}`;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ElapsedTimeBadge({ createdAt }: { createdAt: string }) {
  const elapsed = formatElapsedTime(createdAt);
  const minutesAgo = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60));

  return (
    <span
      className={cn(
        'text-sm',
        minutesAgo < 30
          ? 'text-muted-foreground'
          : minutesAgo < 60
            ? 'font-medium text-amber-600'
            : 'font-medium text-red-600',
      )}
    >
      {elapsed}
    </span>
  );
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// ─── Column Definitions ────────────────────────────────────────────────────────

const sortableColumns = new Set<string>(['customerName', 'status', 'price', 'createdAt']);

function getColumns(activeTab?: DeliveryTab): ColumnDef<DeliveryListItem, unknown>[] {
  const baseColumns: ColumnDef<DeliveryListItem, unknown>[] = [
    {
      id: 'tracking',
      header: 'Tracking',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.id.slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: 'customerName',
      header: 'Customer',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.customerName}</span>
      ),
    },
    {
      id: 'pickupCity',
      header: 'Pickup',
      enableSorting: false,
      cell: ({ row }) => row.original.pickupCity,
    },
    {
      id: 'dropoffCity',
      header: 'Dropoff',
      enableSorting: false,
      cell: ({ row }) => row.original.dropoffCity,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              statusBadgeStyles[status],
            )}
          >
            {statusLabels[status]}
          </span>
        );
      },
    },
    {
      id: 'driver',
      header: 'Driver',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.driverName ? (
          <span className="text-sm">{row.original.driverName}</span>
        ) : (
          <span className="text-xs italic text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'packageCategory',
      header: 'Category',
      enableSorting: false,
      cell: ({ row }) => formatCategory(row.original.packageCategory),
    },
  ];

  // For "requests" tab, add elapsed time column instead of price
  if (activeTab === 'requests') {
    baseColumns.push({
      id: 'elapsedTime',
      header: 'Elapsed',
      enableSorting: false,
      cell: ({ row }) => <ElapsedTimeBadge createdAt={row.original.createdAt} />,
    });
  } else {
    baseColumns.push({
      accessorKey: 'price',
      header: 'Price',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-right tabular-nums">
          {formatPrice(row.original.price)}
        </span>
      ),
    });
  }

  baseColumns.push({
    accessorKey: 'createdAt',
    header: 'Created',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  });

  return baseColumns;
}

// ─── Skeleton Loader ───────────────────────────────────────────────────────────

function SkeletonRows({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 8 }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b">
          {Array.from({ length: columnCount }).map((_, colIndex) => (
            <td key={colIndex} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────────

function getEmptyMessage(activeTab?: DeliveryTab, hasFilters?: boolean): {
  heading: string;
  description: string;
} {
  if (hasFilters) {
    return {
      heading: 'No matching deliveries',
      description: 'Try adjusting your search or filter criteria.',
    };
  }

  switch (activeTab) {
    case 'requests':
      return {
        heading: 'No pending requests',
        description: 'There are currently no delivery requests awaiting assignment.',
      };
    case 'active':
      return {
        heading: 'No active deliveries',
        description: 'There are currently no deliveries in transit.',
      };
    case 'completed':
      return {
        heading: 'No completed deliveries',
        description: 'No deliveries have reached a terminal state yet.',
      };
    default:
      return {
        heading: 'No deliveries found',
        description: 'Deliveries will appear here once customers create them.',
      };
  }
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function DeliveryDataTable({
  data,
  isLoading,
  error,
  onRetry,
  sortBy,
  sortDir,
  onSortChange,
  onRowClick,
  activeTab,
  selectedDeliveryId,
}: DeliveryDataTableProps) {
  const columns = useMemo(() => getColumns(activeTab), [activeTab]);

  const sorting: SortingState = sortBy
    ? [{ id: sortBy, desc: sortDir === 'desc' }]
    : [];

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  // ─── Error State ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16">
        <AlertCircle className="mb-3 size-8 text-destructive" />
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b bg-muted/50">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort() && sortableColumns.has(header.column.id);
                const isActive = sortBy === header.column.id;

                return (
                  <th
                    key={header.id}
                    className={cn(
                      'px-4 py-3 text-left font-medium text-muted-foreground',
                      canSort && 'cursor-pointer select-none hover:text-foreground',
                    )}
                    onClick={
                      canSort
                        ? () => onSortChange(header.column.id as SortBy)
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && isActive &&
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
            <SkeletonRows columnCount={columns.length} />
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-16 text-center"
              >
                <div className="flex flex-col items-center gap-2">
                  <Package className="size-10 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">
                    {getEmptyMessage(activeTab, false).heading}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {getEmptyMessage(activeTab, false).description}
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'cursor-pointer border-b transition-colors hover:bg-muted/50',
                  row.original.id === selectedDeliveryId && 'bg-muted/50 ring-1 ring-inset ring-primary/20',
                )}
                onClick={() => onRowClick(row.original.id)}
              >
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
