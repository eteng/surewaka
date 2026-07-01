import { useCallback, useEffect, useState } from 'react';
import type { DeliveryStatus } from '@surewaka/shared';
import { cn } from '~/lib/utils';
import { useDeliveries } from '~/hooks/use-deliveries';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb';
import { LifecycleTabBar } from './lifecycle-tab-bar';
import { DeliveryToolbar } from './delivery-toolbar';
import { DeliveryDataTable } from './delivery-data-table';
import { DeliveryMap } from './delivery-map';
import { DeliveryDetailView } from './delivery-detail-view';
import type { DeliveryTab } from './lifecycle-tab-bar';

type SortBy = 'createdAt' | 'status' | 'customerName' | 'price';
type SortDir = 'asc' | 'desc';
type ViewMode = 'table' | 'map';

export function DeliveriesPage() {
  // ─── State Management ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<DeliveryTab>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DeliveryStatus | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');

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

  /**
   * Tab switching:
   * - Preserves search text (Req 9.10)
   * - Resets status filter because the lifecycle tab provides an implicit status constraint (Req 9.11)
   * - Resets page to 1
   */
  const handleTabChange = useCallback((tab: DeliveryTab) => {
    setActiveTab(tab);
    setStatus(undefined);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((newStatus: DeliveryStatus | undefined) => {
    setStatus(newStatus);
    setPage(1);
  }, []);

  const handleSortChange = useCallback(
    (column: SortBy) => {
      if (sortBy === column) {
        setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortBy(column);
        setSortDir('desc');
      }
    },
    [sortBy],
  );

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  }, []);

  const handleRowClick = useCallback((deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
  }, []);

  const handleDetailClose = useCallback(() => {
    setSelectedDeliveryId(null);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedDeliveryId) {
        handleDetailClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDeliveryId, handleDetailClose]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <span className="text-muted-foreground">Operations</span>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Deliveries</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

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
    </div>
  );
}
