import { useEffect, useRef, useState } from 'react';
import { Download, Filter, Search } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

const VEHICLE_TYPES = [
  { label: 'All', value: undefined },
  { label: 'Motorcycle', value: 'motorcycle' },
  { label: 'Car', value: 'car' },
  { label: 'Van', value: 'van' },
  { label: 'Truck', value: 'truck' },
] as const;

const VERIFIED_OPTIONS = [
  { label: 'All', value: undefined },
  { label: 'Verified', value: 'true' },
  { label: 'Unverified', value: 'false' },
] as const;

const AVAILABLE_OPTIONS = [
  { label: 'All', value: undefined },
  { label: 'Available', value: 'true' },
  { label: 'Unavailable', value: 'false' },
] as const;

const AFFILIATION_OPTIONS = [
  { label: 'All', value: undefined },
  { label: 'Independent', value: 'independent' },
  { label: 'Carrier', value: 'carrier' },
] as const;

type DriverToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  vehicleType: string | undefined;
  onVehicleTypeChange: (value: string | undefined) => void;
  verified: string | undefined;
  onVerifiedChange: (value: string | undefined) => void;
  available: string | undefined;
  onAvailableChange: (value: string | undefined) => void;
  affiliation: string | undefined;
  onAffiliationChange: (value: string | undefined) => void;
  onExport: () => void;
  isExporting?: boolean;
};

export function DriverToolbar({
  search,
  onSearchChange,
  vehicleType,
  onVehicleTypeChange,
  verified,
  onVerifiedChange,
  available,
  onAvailableChange,
  affiliation,
  onAffiliationChange,
  onExport,
  isExporting = false,
}: DriverToolbarProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when external search prop changes (e.g. URL navigation)
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Debounce search input by 300ms
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      if (localSearch !== search) {
        onSearchChange(localSearch);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [localSearch, search, onSearchChange]);

  return (
    <div
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      role="toolbar"
      aria-label="Driver list filters"
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Search by name or phone..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
            aria-label="Search drivers"
          />
        </div>

        {/* Vehicle Type Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {vehicleType ? VEHICLE_TYPES.find((t) => t.value === vehicleType)?.label : 'Vehicle'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Vehicle Type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {VEHICLE_TYPES.map((t) => (
              <DropdownMenuCheckboxItem
                key={t.label}
                checked={vehicleType === t.value}
                onCheckedChange={() => onVehicleTypeChange(t.value)}
              >
                {t.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Verified Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {verified ? VERIFIED_OPTIONS.find((v) => v.value === verified)?.label : 'Verified'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Verification Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {VERIFIED_OPTIONS.map((v) => (
              <DropdownMenuCheckboxItem
                key={v.label}
                checked={verified === v.value}
                onCheckedChange={() => onVerifiedChange(v.value)}
              >
                {v.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Available Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {available ? AVAILABLE_OPTIONS.find((a) => a.value === available)?.label : 'Available'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Availability</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {AVAILABLE_OPTIONS.map((a) => (
              <DropdownMenuCheckboxItem
                key={a.label}
                checked={available === a.value}
                onCheckedChange={() => onAvailableChange(a.value)}
              >
                {a.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Affiliation Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {affiliation ? AFFILIATION_OPTIONS.find((a) => a.value === affiliation)?.label : 'Affiliation'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Carrier Affiliation</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {AFFILIATION_OPTIONS.map((a) => (
              <DropdownMenuCheckboxItem
                key={a.label}
                checked={affiliation === a.value}
                onCheckedChange={() => onAffiliationChange(a.value)}
              >
                {a.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        {/* Export Button */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onExport}
          disabled={isExporting}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{isExporting ? 'Exporting...' : 'Export CSV'}</span>
        </Button>
      </div>
    </div>
  );
}
