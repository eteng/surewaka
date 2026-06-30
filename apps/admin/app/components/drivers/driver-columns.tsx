import { createColumnHelper } from '@tanstack/react-table';
import { Star } from 'lucide-react';
import type { DriverListItem } from '@surewaka/shared';
import { Badge } from '~/components/ui/badge';

const columnHelper = createColumnHelper<DriverListItem>();

function AvatarCell({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {initials}
        </div>
      )}
      <span className="font-medium">{name}</span>
    </div>
  );
}

function VehicleTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    motorcycle: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    car: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    van: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    truck: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  };

  return (
    <Badge variant="outline" className={styles[type] ?? ''}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

export const columns = [
  columnHelper.display({
    id: 'name',
    header: 'Driver',
    cell: (info) => (
      <AvatarCell name={info.row.original.name} avatarUrl={info.row.original.avatarUrl} />
    ),
    enableSorting: true,
  }),
  columnHelper.accessor('phone', {
    header: 'Phone',
    cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
    enableSorting: false,
  }),
  columnHelper.accessor('vehicleType', {
    header: 'Vehicle',
    cell: (info) => <VehicleTypeBadge type={info.getValue()} />,
    enableSorting: false,
  }),
  columnHelper.accessor('verified', {
    header: 'Verified',
    cell: (info) =>
      info.getValue() ? (
        <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
          Verified
        </Badge>
      ) : (
        <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">
          Unverified
        </Badge>
      ),
    enableSorting: false,
  }),
  columnHelper.accessor('available', {
    header: 'Available',
    cell: (info) =>
      info.getValue() ? (
        <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
          Available
        </Badge>
      ) : (
        <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">
          Unavailable
        </Badge>
      ),
    enableSorting: false,
  }),
  columnHelper.accessor('rating', {
    header: 'Rating',
    cell: (info) => (
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-hidden="true" />
        {info.getValue().toFixed(1)}
      </span>
    ),
    enableSorting: true,
  }),
  columnHelper.accessor('totalDeliveries', {
    header: 'Deliveries',
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    enableSorting: true,
  }),
  columnHelper.accessor('carrierName', {
    header: 'Carrier',
    cell: (info) => (
      <span className="text-sm text-muted-foreground">{info.getValue() ?? 'Independent'}</span>
    ),
    enableSorting: false,
  }),
  columnHelper.accessor('createdAt', {
    header: 'Joined',
    cell: (info) => (
      <span className="text-sm text-muted-foreground">
        {new Date(info.getValue()).toLocaleDateString('en-NG', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </span>
    ),
    enableSorting: true,
  }),
];
