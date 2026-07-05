# Deliveries UI/UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the admin deliveries page usability through a split-panel layout, cleaner toolbar, urgency signals on tabs/elapsed time, a driver column, and consistent shadcn pagination.

**Architecture:** The page becomes a two-column layout when a delivery is selected (table left, sticky detail panel right). Toolbar sort controls are removed — column header clicking handles all sorting. The table gains a driver column, elapsed-time urgency coloring, and a time-aware date format. Pagination and view-mode toggle are upgraded to shadcn components with text labels.

**Tech Stack:** React, React Router v7, TanStack Table, shadcn/ui, Tailwind v4, Lucide React

## Global Constraints

- Use `cn()` for all conditional class names
- Icons from `lucide-react` only
- shadcn components from `~/components/ui/*`
- No new dependencies
- TypeScript strict mode, `type` over `interface`
- `DeliveryListItem.driverName: string | null` is already in `@surewaka/shared` and in the API response — no backend changes needed

---

### Task 1: Split-Panel Layout

**Files:**
- Modify: `apps/admin/app/components/deliveries/deliveries-page.tsx`
- Modify: `apps/admin/app/components/deliveries/delivery-data-table.tsx`

**Interfaces:**
- Produces: when `selectedDeliveryId` is set, the page renders table (flex-1) + sticky detail panel (w-[420px]) side-by-side; full-width otherwise
- `DeliveryDataTable` gains optional `selectedDeliveryId?: string | null` prop for row highlight

- [ ] **Step 1: Add Escape key handler to `deliveries-page.tsx`**

Add `useEffect` to the existing import line (it's already there as `useCallback, useState`) and add the effect inside `DeliveriesPage`, after the existing handlers:

```tsx
// Change: import { useCallback, useState } from 'react';
import { useCallback, useEffect, useState } from 'react';

// Inside DeliveriesPage, after handleViewModeChange:
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && selectedDeliveryId) {
      handleDetailClose();
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [selectedDeliveryId, handleDetailClose]);
```

- [ ] **Step 2: Replace the content area + detail render in `deliveries-page.tsx`**

In the `return`, replace the block that starts with `{/* Content Area */}` through the closing `</div>` of the page (currently lines 147–212). The new version:

```tsx
{/* Content Area — splits when detail is open */}
{viewMode === 'map' ? (
  <DeliveryMap data={data} isLoading={isLoading} />
) : (
  <div className={cn('flex gap-6', selectedDeliveryId ? 'items-start' : '')}>
    {/* Table + Pagination */}
    <div className={cn('flex min-w-0 flex-col gap-4', selectedDeliveryId ? 'flex-1' : 'w-full')}>
      <DeliveryDataTable
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        onRowClick={handleRowClick}
        activeTab={activeTab}
        selectedDeliveryId={selectedDeliveryId}
      />
      {meta && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {data.length} of {meta.total} deliveries
          </p>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="h-9 rounded-md border px-2 text-sm"
            >
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="h-9 cursor-pointer rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                Previous
              </button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {meta.page} of {meta.totalPages}
              </span>
              <button
                type="button"
                className="h-9 cursor-pointer rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={page >= meta.totalPages}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Sticky Detail Panel */}
    {selectedDeliveryId && (
      <div className="w-[420px] shrink-0 self-start sticky top-6">
        <DeliveryDetailView
          deliveryId={selectedDeliveryId}
          onClose={handleDetailClose}
        />
      </div>
    )}
  </div>
)}
```

Also add `cn` import since it's needed:
```tsx
import { cn } from '~/lib/utils';
```

- [ ] **Step 3: Add `selectedDeliveryId` prop to `DeliveryDataTable`**

In `delivery-data-table.tsx`, add to `DeliveryDataTableProps`:

```tsx
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
```

Add `selectedDeliveryId` to the function signature and use it in the row:

```tsx
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
```

Update the data rows to highlight the selected row:

```tsx
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
```

- [ ] **Step 4: Verify manually**

Start dev server: `pnpm --filter @surewaka/admin dev`
- Click a delivery row → detail panel appears on the right, table narrows to fill remaining space
- Selected row shows a subtle ring highlight
- Press Escape → detail panel closes, table returns to full width
- Table and detail are visible simultaneously without scrolling

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/components/deliveries/deliveries-page.tsx apps/admin/app/components/deliveries/delivery-data-table.tsx
git commit -m "feat(admin): split-panel layout for delivery list + detail"
```

---

### Task 2: Remove Toolbar Sort Controls + View Mode Text Labels

**Files:**
- Modify: `apps/admin/app/components/deliveries/delivery-toolbar.tsx`
- Modify: `apps/admin/app/components/deliveries/deliveries-page.tsx`

**Interfaces:**
- `DeliveryToolbar` loses `sortBy`, `sortDir`, `onSortChange` props
- View mode buttons gain text labels "Table" and "Map"

- [ ] **Step 1: Rewrite `delivery-toolbar.tsx`**

Replace the entire file content with:

```tsx
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
```

- [ ] **Step 2: Remove sort props from `<DeliveryToolbar>` call in `deliveries-page.tsx`**

Update the `<DeliveryToolbar>` JSX in `deliveries-page.tsx`:

```tsx
<DeliveryToolbar
  search={search}
  onSearchChange={handleSearchChange}
  status={status}
  onStatusChange={handleStatusChange}
  viewMode={viewMode}
  onViewModeChange={handleViewModeChange}
/>
```

Note: `sortBy`, `sortDir`, `setSortBy`, `setSortDir`, `handleSortChange` remain in `deliveries-page.tsx` — they're still wired to `DeliveryDataTable`.

- [ ] **Step 3: Verify**

- Toolbar shows: search, status filter, clear filters (conditional), Table/Map toggle with text labels
- No sort controls in toolbar
- Column headers in table still sort on click
- No TypeScript errors: `pnpm --filter @surewaka/admin typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/components/deliveries/delivery-toolbar.tsx apps/admin/app/components/deliveries/deliveries-page.tsx
git commit -m "feat(admin): remove toolbar sort controls, add text labels to view toggle"
```

---

### Task 3: Tab Count Urgency Badges

**Files:**
- Modify: `apps/admin/app/components/deliveries/lifecycle-tab-bar.tsx`

**Interfaces:**
- `TabCountBadge` gains `tabId: DeliveryTab` param

- [ ] **Step 1: Update `TabCountBadge` and its usage in `lifecycle-tab-bar.tsx`**

Replace `TabCountBadge`:

```tsx
function TabCountBadge({ count, tabId }: { count: number; tabId: DeliveryTab }) {
  return (
    <span
      className={cn(
        'ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        tabId === 'requests' && count > 0
          ? 'bg-amber-100 text-amber-700'
          : tabId === 'active' && count > 0
            ? 'bg-blue-100 text-blue-700'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {count}
    </span>
  );
}
```

Update the call site inside `LifecycleTabBar`:

```tsx
{tabCounts && <TabCountBadge count={tabCounts[tab.id]} tabId={tab.id} />}
```

- [ ] **Step 2: Verify**

- Requests tab badge: amber when count > 0, neutral when 0
- Active tab badge: blue when count > 0, neutral when 0
- All and Completed tabs: always neutral muted style

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/components/deliveries/lifecycle-tab-bar.tsx
git commit -m "feat(admin): urgency colors on lifecycle tab count badges"
```

---

### Task 4: Table Improvements

**Files:**
- Modify: `apps/admin/app/components/deliveries/delivery-data-table.tsx`

**Interfaces:**
- `ElapsedTimeBadge({ createdAt: string })` — new internal component
- `DeliveryListItem.driverName: string | null` is already in `@surewaka/shared`

- [ ] **Step 1: Add overflow wrapper**

In `delivery-data-table.tsx`, change the return wrapper from:

```tsx
return (
  <div className="rounded-md border">
    <table className="w-full text-sm">
```

to:

```tsx
return (
  <div className="overflow-x-auto rounded-md border">
    <table className="w-full text-sm">
```

- [ ] **Step 2: Update `formatDate` for same-day time**

Replace the existing `formatDate` function:

```tsx
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
```

- [ ] **Step 3: Add `ElapsedTimeBadge` component**

Add after `formatDate`:

```tsx
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
```

- [ ] **Step 4: Add driver column and use `ElapsedTimeBadge` in `getColumns`**

In `getColumns`, add the driver column after the status column (`{ accessorKey: 'status', ... }`):

```tsx
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
```

Replace the `elapsedTime` column cell to use the new component:

```tsx
{
  id: 'elapsedTime',
  header: 'Elapsed',
  enableSorting: false,
  cell: ({ row }) => <ElapsedTimeBadge createdAt={row.original.createdAt} />,
},
```

- [ ] **Step 5: Verify**

- Table has "Driver" column showing name or "Unassigned" in italic
- Today's deliveries show "Today, 2:34 PM" format in Created column
- On Requests tab: elapsed < 30m is gray, 30–60m is amber bold, >60m is red bold
- Table scrolls horizontally without breaking layout on narrow screens

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/components/deliveries/delivery-data-table.tsx
git commit -m "feat(admin): driver column, elapsed urgency coloring, today time format, overflow fix"
```

---

### Task 5: Pagination — shadcn Components

**Files:**
- Modify: `apps/admin/app/components/deliveries/deliveries-page.tsx`

**Interfaces:**
- Consumes: `Button` (already imported), `Select*` from `~/components/ui/select`, `ChevronLeft`, `ChevronRight` from `lucide-react`

- [ ] **Step 1: Add imports to `deliveries-page.tsx`**

Add to the import block:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
```

- [ ] **Step 2: Replace pagination markup in the split layout**

In the `{meta && (...)}` block inside the table branch, replace the existing pagination with:

```tsx
{meta && (
  <div className="flex items-center justify-between">
    <p className="text-sm text-muted-foreground">
      Showing {data.length} of {meta.total} deliveries
    </p>
    <div className="flex items-center gap-2">
      <Select
        value={String(pageSize)}
        onValueChange={(v) => handlePageSizeChange(Number(v))}
      >
        <SelectTrigger className="h-9 w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[10, 20, 50, 100].map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} / page
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => handlePageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="px-2 text-sm text-muted-foreground">
          {meta.page} / {meta.totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= meta.totalPages}
          onClick={() => handlePageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify**

- Page size dropdown uses shadcn Select — visually consistent
- Previous / Next use shadcn Button with chevron icons
- Disabled states work correctly at page boundaries
- No TypeScript errors: `pnpm --filter @surewaka/admin typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/components/deliveries/deliveries-page.tsx
git commit -m "feat(admin): pagination uses shadcn Button and Select components"
```
