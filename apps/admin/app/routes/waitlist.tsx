import { Component, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useWaitlistParams } from '~/hooks/use-waitlist-params';
import { useWaitlistData } from '~/hooks/use-waitlist-data';
import { useWaitlistStats } from '~/hooks/use-waitlist-stats';
import { WaitlistStatsCards } from '~/components/waitlist/stats-cards';
import { WaitlistToolbar } from '~/components/waitlist/toolbar';
import { WaitlistDataTable } from '~/components/waitlist/data-table';
import { WaitlistPagination } from '~/components/waitlist/pagination';
import { exportWaitlistCsv } from '~/lib/export-csv';
import { supabase } from '~/lib/supabase';
import { Button } from '~/components/ui/button';

export function meta() {
  return [{ title: 'SureWaka Admin - Waitlist' }];
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class WaitlistErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

function WaitlistPage() {
  const {
    params,
    setPage,
    setPageSize,
    setSearch,
    setUserType,
    setSource,
    toggleSort,
  } = useWaitlistParams();

  const { data, meta, isLoading, error, refetch } = useWaitlistData(params as Parameters<typeof useWaitlistData>[0]);
  const { stats, isLoading: statsLoading } = useWaitlistStats();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        return;
      }

      // Fetch all filtered records (no pagination) for export
      const exportParams = new URLSearchParams();
      if (params.search) exportParams.set('search', params.search);
      if (params.userType) exportParams.set('userType', params.userType);
      if (params.source) exportParams.set('source', params.source);
      exportParams.set('pageSize', '10000');
      exportParams.set('page', '1');

      const url = `${API_URL}/api/v1/admin/waitlist?${exportParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return;
      }

      const body = await response.json();
      if (body.data && body.data.length > 0) {
        exportWaitlistCsv(body.data);
      }
    } finally {
      setIsExporting(false);
    }
  }, [params.search, params.userType, params.source]);

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Waitlist</h1>
        <p className="text-sm text-muted-foreground">Manage waitlist signups</p>
      </div>

      {/* Stats cards */}
      <WaitlistStatsCards stats={stats} isLoading={statsLoading} />

      {/* Toolbar */}
      <WaitlistToolbar
        search={params.search}
        onSearchChange={setSearch}
        userType={params.userType}
        onUserTypeChange={setUserType}
        source={params.source}
        onSourceChange={setSource}
        onExport={handleExport}
        isExporting={isExporting}
      />

      {/* Data table */}
      <WaitlistDataTable
        data={data}
        pageCount={meta?.totalPages ?? 0}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        sortBy={params.sortBy}
        sortDir={params.sortDir}
        onSortChange={toggleSort}
      />

      {/* Pagination */}
      <WaitlistPagination
        page={params.page}
        pageSize={params.pageSize}
        total={meta?.total ?? 0}
        totalPages={meta?.totalPages ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}

export default function WaitlistRoute() {
  return (
    <WaitlistErrorBoundary>
      <WaitlistPage />
    </WaitlistErrorBoundary>
  );
}
