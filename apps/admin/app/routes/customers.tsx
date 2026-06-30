import { Component, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useCustomerParams } from '~/hooks/use-customer-params';
import { useCustomerData } from '~/hooks/use-customer-data';
import { useProfile } from '~/hooks/use-profile';
import { CustomerToolbar } from '~/components/customers/customer-toolbar';
import { CustomerDataTable } from '~/components/customers/customer-data-table';
import { CustomerPagination } from '~/components/customers/customer-pagination';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { useAuth } from '@clerk/react';

export function meta() {
  return [{ title: 'SureWaka Admin - Customers' }];
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class CustomersErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="ml-auto h-10 w-32" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-48" />
      </div>
    </div>
  );
}

function CustomersPage() {
  const { getToken } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();
  const {
    params,
    setPage,
    setPageSize,
    setSearch,
    setTier,
    setVerified,
    toggleSort,
  } = useCustomerParams();

  const { data, meta, isLoading, error, refetch } = useCustomerData(params);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const accessToken = await getToken();
      if (!accessToken) return;

      const exportParams = new URLSearchParams();
      if (params.search) exportParams.set('search', params.search);
      if (params.tier) exportParams.set('tier', params.tier);
      if (params.verified) exportParams.set('verified', params.verified);
      if (params.city) exportParams.set('city', params.city);
      if (params.joinedFrom) exportParams.set('joinedFrom', params.joinedFrom);
      if (params.joinedTo) exportParams.set('joinedTo', params.joinedTo);
      exportParams.set('pageSize', '10000');
      exportParams.set('page', '1');

      const url = `${API_URL}/api/v1/admin/customers?${exportParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return;

      const body = await response.json();
      if (body.data && body.data.length > 0) {
        exportCustomersCsv(body.data);
      }
    } finally {
      setIsExporting(false);
    }
  }, [getToken, params]);

  if (profileLoading) {
    return <LoadingSkeleton />;
  }

  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  return (
    <RoleGate
      roles={['surewaka_admin']}
      userRoles={userRoles}
      fallback={
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            You do not have permission to view this page.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            View and manage customer accounts, activity, and segments
          </p>
        </div>

        {/* Toolbar */}
        <CustomerToolbar
          search={params.search}
          onSearchChange={setSearch}
          tier={params.tier}
          onTierChange={setTier}
          verified={params.verified}
          onVerifiedChange={setVerified}
          onExport={handleExport}
          isExporting={isExporting}
        />

        {/* Data table */}
        <CustomerDataTable
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
        <CustomerPagination
          page={params.page}
          pageSize={params.pageSize}
          total={meta?.total ?? 0}
          totalPages={meta?.totalPages ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </RoleGate>
  );
}

// ─── CSV Export Helper ────────────────────────────────────────────────────────

function exportCustomersCsv(data: Array<Record<string, unknown>>) {
  const headers = ['Name', 'Phone', 'Email', 'Tier', 'Deliveries', 'Total Spent (₦)', 'Last Active', 'Verified', 'Joined'];
  const rows = data.map((c) => [
    c.name ?? '',
    c.phone ?? '',
    c.email ?? '',
    c.tier ?? '',
    String(c.totalDeliveries ?? 0),
    String((c.totalSpent as number ?? 0) / 100),
    c.lastDeliveryAt ?? '',
    c.verified ? 'Yes' : 'No',
    c.createdAt ?? '',
  ]);

  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `surewaka-customers-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CustomersRoute() {
  return (
    <CustomersErrorBoundary>
      <CustomersPage />
    </CustomersErrorBoundary>
  );
}
