import { useEffect, useRef, useState } from 'react';
import { Search, X, Table, Map } from 'lucide-react';
import type { DeliveryStatus } from '@surewaka/shared';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

type ViewMode = 'table' | 'map';

type DeliveryToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  status: DeliveryStatus | undefined;
  onStatusChange: (status: DeliveryStatus | undefined) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
};

const DELIVERY_STATUSES: { label: string; value: DeliveryStatus }[] = [
  { label: 'Draft', value: 'draft' },
  { label: 'Pending', value: 'pending' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'En Route Pickup', value: 'en_route_pickup' },
  { label: 'Arrived Pickup', value: 'arrived_pickup' },
  { label: 'Picked Up', value: 'picked_up' },
  { label: 'En Route Dropoff', value: 'en_route_dropoff' },
  { label: 'Arrived Dropoff', value: 'arrived_dropoff' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Failed', value: 'failed' },
  { label: 'Returned', value: 'returned' },
];

export function DeliveryToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  viewMode,
  onViewModeChange,
}: DeliveryToolbarProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (localSearch.length >= 2 || localSearch === '') {
        if (localSearch !== search) onSearchChange(localSearch);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch, search, onSearchChange]);

  const handleClearSearch = () => {
    setLocalSearch('');
    onSearchChange('');
  };

  const handleClearFilters = () => {
    setLocalSearch('');
    onSearchChange('');
    onStatusChange(undefined);
  };

  const hasActiveFilters = search !== '' || status !== undefined;

  return (
    <div
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      role="toolbar"
      aria-label="Delivery list filters"
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search deliveries..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9 pr-9"
            aria-label="Search deliveries"
          />
          {localSearch && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2.5 top-2.5 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <Select
          value={status ?? 'all'}
          onValueChange={(value) =>
            onStatusChange(value === 'all' ? undefined : (value as DeliveryStatus))
          }
        >
          <SelectTrigger className="w-44 cursor-pointer">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {DELIVERY_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="mr-1 h-3 w-3" />
            Clear filters
          </Button>
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 rounded-md border p-1">
        <button
          type="button"
          onClick={() => onViewModeChange('table')}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition-colors',
            viewMode === 'table'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label="Table view"
          aria-pressed={viewMode === 'table'}
        >
          <Table className="h-4 w-4" />
          Table
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('map')}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition-colors',
            viewMode === 'map'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label="Map view"
          aria-pressed={viewMode === 'map'}
        >
          <Map className="h-4 w-4" />
          Map
        </button>
      </div>
    </div>
  );
}
