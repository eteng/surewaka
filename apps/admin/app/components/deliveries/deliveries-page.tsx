import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DeliveryStatus } from '@surewaka/shared';
import { cn } from '~/lib/utils';
import { useDeliveries } from '~/hooks/use-deliveries';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { LifecycleTabBar } from './lifecycle-tab-bar';
import { DeliveryToolbar } from './delivery-toolbar';
import { DeliveryDataTable } from './delivery-data-table';
import { DeliveryMap } from './delivery-map';
import { DeliveryDetailView } from './delivery-detail-view';
import type { DetailTab } from './delivery-detail-view';
import type { DeliveryTab } from './lifecycle-tab-bar';

type SortBy = 'createdAt' | 'status' | 'customerName' | 'price';
type SortDir = 'asc' | 'desc';
type ViewMode = 'table' | 'map';

const VALID_TABS: DeliveryTab[] = ['all', 'requests', 'active', 'completed'];
const VALID_SORT_COLS: SortBy[] = ['createdAt', 'status', 'customerName', 'price'];

export function DeliveriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ─── Read state from URL ────────────────────────────────────────────────────
  const rawTab = searchParams.get('tab') as DeliveryTab;
  const activeTab: DeliveryTab = VALID_TABS.includes(rawTab) ? rawTab : 'active';

  const page       = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize   = Number(searchParams.get('size') ?? '20') || 20;
  const search     = searchParams.get('q') ?? '';
  const status     = (searchParams.get('status') as DeliveryStatus) || undefined;

  const rawSort    = searchParams.get('sortBy') as SortBy;
  const sortBy: SortBy   = VALID_SORT_COLS.includes(rawSort) ? rawSort : 'createdAt';
  const sortDir: SortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const selectedDeliveryId = searchParams.get('id') || null;
  const viewMode: ViewMode = searchParams.get('view') === 'map' ? 'map' : 'table';
  // [N1] Detail tab persisted in URL so refreshing / sharing preserves the selected tab
  const detailTab: DetailTab = searchParams.get('dtab') === 'details' ? 'details' : 'timeline';

  // ─── URL mutation helper ────────────────────────────────────────────────────
  // replace: true keeps the history stack clean for filter/sort/page changes.
  // Opening a detail uses replace: false so back button closes the panel.
  function patch(updates: Record<string, string | null>, opts?: { replace?: boolean }) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: opts?.replace ?? true },
    );
  }

  // ─── Data Fetching ──────────────────────────────────────────────────────────
  const { data, meta, isLoading, error, refetch } = useDeliveries({
    page,
    pageSize,
    search: search || undefined,
    status,
    tab: activeTab,
    sortBy,
    sortDir,
  });

  // ─── Event Handlers ─────────────────────────────────────────────────────────

  const handleTabChange = useCallback((tab: DeliveryTab) => {
    patch({ tab, status: null, page: null });
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    patch({ q: value || null, page: null });
  }, []);

  const handleStatusChange = useCallback((newStatus: DeliveryStatus | undefined) => {
    patch({ status: newStatus ?? null, page: null });
  }, []);

  const handleSortChange = useCallback((column: SortBy) => {
    if (sortBy === column) {
      patch({ sortDir: sortDir === 'desc' ? 'asc' : 'desc' });
    } else {
      patch({ sortBy: column, sortDir: 'desc' });
    }
  }, [sortBy, sortDir]);

  const handlePageChange = useCallback((newPage: number) => {
    patch({ page: String(newPage) });
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    patch({ size: String(newSize), page: null });
  }, []);

  const handleRowClick = useCallback((deliveryId: string) => {
    // Reset dtab to default (timeline) when switching to a new delivery
    patch({ id: deliveryId, dtab: null }, { replace: false });
  }, []);

  const handleDetailClose = useCallback(() => {
    patch({ id: null, dtab: null });
  }, []);

  const handleDetailTabChange = useCallback((t: DetailTab) => {
    // Only write dtab to URL for the non-default tab to keep URLs clean
    patch({ dtab: t === 'timeline' ? null : t });
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    patch({ view: mode === 'map' ? 'map' : null });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedDeliveryId) handleDetailClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDeliveryId, handleDetailClose]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Monitor and manage all delivery orders across the platform
        </p>
      </div>

      {/* Lifecycle Tab Bar */}
      <LifecycleTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        tabCounts={meta?.tabCounts ?? null}
      />

      {/* Toolbar */}
      <DeliveryToolbar
        search={search}
        onSearchChange={handleSearchChange}
        status={status}
        onStatusChange={handleStatusChange}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      {/* Content Area — splits when detail is open */}
      {viewMode === 'map' ? (
        <DeliveryMap data={data} isLoading={isLoading} />
      ) : (
        // [L1] <lg: detail takes full width, table hidden. lg+: 50/50 split.
        <div className={cn('flex gap-4', selectedDeliveryId ? 'items-start' : '')}>
          {/* Table + Pagination — hidden on small screens when detail is open */}
          <div className={cn('flex min-w-0 flex-col gap-4', selectedDeliveryId ? 'hidden lg:flex lg:w-1/2' : 'w-full')}>
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
          </div>

          {/* Detail Panel — full width on <lg, half on lg+ */}
          {selectedDeliveryId && (
            <div className="w-full lg:w-1/2 shrink-0 self-start sticky top-6">
              <DeliveryDetailView
                deliveryId={selectedDeliveryId}
                onClose={handleDetailClose}
                tab={detailTab}
                onTabChange={handleDetailTabChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
