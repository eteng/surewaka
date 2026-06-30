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

const TIERS = [
  { label: 'All', value: undefined },
  { label: 'Power', value: 'power' },
  { label: 'Regular', value: 'regular' },
  { label: 'New', value: 'new' },
  { label: 'Dormant', value: 'dormant' },
] as const;

const VERIFIED_OPTIONS = [
  { label: 'All', value: undefined },
  { label: 'Verified', value: 'true' },
  { label: 'Unverified', value: 'false' },
] as const;

type CustomerToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  tier: string | undefined;
  onTierChange: (value: string | undefined) => void;
  verified: string | undefined;
  onVerifiedChange: (value: string | undefined) => void;
  onExport: () => void;
  isExporting?: boolean;
};

export function CustomerToolbar({
  search,
  onSearchChange,
  tier,
  onTierChange,
  verified,
  onVerifiedChange,
  onExport,
  isExporting = false,
}: CustomerToolbarProps) {
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
      aria-label="Customer list filters"
    >
      <div className="flex flex-1 items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Search by name, email, or phone..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
            aria-label="Search customers"
          />
        </div>

        {/* Tier Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {tier ? TIERS.find((t) => t.value === tier)?.label : 'Tier'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Customer Tier</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {TIERS.map((t) => (
              <DropdownMenuCheckboxItem
                key={t.label}
                checked={tier === t.value}
                onCheckedChange={() => onTierChange(t.value)}
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
                {verified
                  ? VERIFIED_OPTIONS.find((v) => v.value === verified)?.label
                  : 'Verified'}
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
