import { useNavigate } from 'react-router';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '~/lib/utils';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';

type EmployeeRole = {
  role: string;
  scopeType: string | null;
  scopeId: string | null;
};

type EmployeeListItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  verified: boolean;
  roles: EmployeeRole[];
  createdAt: string;
  updatedAt: string;
};

type EmployeeDataTableProps = {
  data: EmployeeListItem[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (column: string) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const roleBadgeStyles: Record<string, string> = {
  surewaka_admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  carrier_admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  carrier_driver: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  support_agent: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

function getRoleBadgeStyle(role: string): string {
  return roleBadgeStyles[role] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

const columns: ColumnDef<EmployeeListItem, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    enableSorting: true,
  },
  {
    accessorKey: 'phone',
    header: 'Phone',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.phone ?? '—'}
      </span>
    ),
  },
  {
    id: 'roles',
    header: 'Roles',
    enableSorting: false,
    cell: ({ row }) => {
      const roles = row.original.roles;
      if (roles.length === 0) {
        return <span className="text-muted-foreground">No roles</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {roles.map((r, idx) => (
            <span
              key={`${r.role}-${idx}`}
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                getRoleBadgeStyle(r.role),
              )}
            >
              {formatRoleLabel(r.role)}
            </span>
          ))}
        </div>
      );
    },
  },
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => {
      const isActive = row.original.verified;
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            isActive
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
          )}
        >
          {isActive ? 'Active' : 'Inactive'}
        </span>
      );
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

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

export function EmployeeDataTable({
  data,
  sortBy,
  sortDir,
  onSort,
  isLoading = false,
  error = null,
  onRetry,
}: EmployeeDataTableProps) {
  const navigate = useNavigate();

  const sorting: SortingState = sortBy
    ? [{ id: sortBy, desc: sortDir === 'desc' }]
    : [];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16">
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
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
                    className={cn(
                      'px-4 py-3 text-left font-medium text-muted-foreground',
                      canSort && 'cursor-pointer select-none',
                    )}
                    onClick={canSort ? () => onSort(header.column.id) : undefined}
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
                No employees found matching your filters
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                onClick={() => navigate(`/users/${row.original.id}`)}
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
