import { useEffect, useRef, useState } from 'react';
import { Filter, Plus, Search } from 'lucide-react';
import { USER_ROLES } from '@surewaka/shared';
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

const ROLE_OPTIONS = [
  { label: 'All Roles', value: undefined },
  ...USER_ROLES.map((role) => ({
    label: role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: role,
  })),
] as const;

const STATUS_OPTIONS = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
] as const;

type EmployeeToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  role: string | undefined;
  onRoleChange: (value: string | undefined) => void;
  status: string | undefined;
  onStatusChange: (value: string | undefined) => void;
  onInviteClick: () => void;
};

export function EmployeeToolbar({
  search,
  onSearchChange,
  role,
  onRoleChange,
  status,
  onStatusChange,
  onInviteClick,
}: EmployeeToolbarProps) {
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
            placeholder="Search by name, email, or phone..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Role Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">
                {role
                  ? ROLE_OPTIONS.find((r) => r.value === role)?.label
                  : 'Role'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Role</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ROLE_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.label}
                checked={role === option.value}
                onCheckedChange={() => onRoleChange(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Status Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">
                {status
                  ? STATUS_OPTIONS.find((s) => s.value === status)?.label
                  : 'Status'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {STATUS_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.label}
                checked={status === option.value}
                onCheckedChange={() => onStatusChange(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={onInviteClick}>
          <Plus className="h-4 w-4" />
          <span>Invite Employee</span>
        </Button>
      </div>
    </div>
  );
}
