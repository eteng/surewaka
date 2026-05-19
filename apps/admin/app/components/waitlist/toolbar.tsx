import { useEffect, useRef, useState } from 'react';
import { Columns, Download, Filter, Search } from 'lucide-react';
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

const USER_TYPES = [
  { label: 'All', value: undefined },
  { label: 'Sender', value: 'sender' },
  { label: 'Business', value: 'business' },
  { label: 'Driver', value: 'driver' },
] as const;

const SOURCES = [
  { label: 'All', value: undefined },
  { label: 'Home', value: 'home' },
  { label: 'Launch Campaign', value: 'launch-campaign' },
  { label: 'Referral', value: 'referral' },
  { label: 'Social', value: 'social' },
] as const;

type WaitlistToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  userType: string | undefined;
  onUserTypeChange: (value: string | undefined) => void;
  source: string | undefined;
  onSourceChange: (value: string | undefined) => void;
  onExport: () => void;
  isExporting?: boolean;
};

export function WaitlistToolbar({
  search,
  onSearchChange,
  userType,
  onUserTypeChange,
  source,
  onSourceChange,
  onExport,
  isExporting = false,
}: WaitlistToolbarProps) {
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* User Type Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">
                {userType ? USER_TYPES.find((t) => t.value === userType)?.label : 'User Type'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>User Type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {USER_TYPES.map((type) => (
              <DropdownMenuCheckboxItem
                key={type.label}
                checked={userType === type.value}
                onCheckedChange={() => onUserTypeChange(type.value)}
              >
                {type.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Source Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">
                {source ? SOURCES.find((s) => s.value === source)?.label : 'Source'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Source</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SOURCES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s.label}
                checked={source === s.value}
                onCheckedChange={() => onSourceChange(s.value)}
              >
                {s.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        {/* Column Visibility Toggle (placeholder) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Columns className="h-4 w-4" />
              <span className="hidden sm:inline">Columns</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked>Full Name</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>Email</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>User Type</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>Source</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>Signup Date</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export Button */}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onExport} disabled={isExporting}>
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">{isExporting ? 'Exporting...' : 'Export'}</span>
        </Button>
      </div>
    </div>
  );
}
