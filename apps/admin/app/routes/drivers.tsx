import { Component, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useDriverParams } from '~/hooks/use-driver-params';
import { useDriverData } from '~/hooks/use-driver-data';
import { useProfile } from '~/hooks/use-profile';
import { DriverToolbar } from '~/components/drivers/driver-toolbar';
import { DriverDataTable } from '~/components/drivers/driver-data-table';
import { DriverPagination } from '~/components/drivers/driver-pagination';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { useAuth } from '@clerk/react';

export function meta() {
  return [{ title: 'SureWaka Admin - Drivers' }];
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class DriversErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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

function DriversPage() {
  const { getToken } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();
  const {
    params,
    setPage,
    setPageSize,
    setSearch,
    setVehicleType,
    setVerified,
    setAvailable,
    setAffiliation,
    toggleSort,
  } = useDriverParams();

  const { data, meta, isLoading, error, refetch } = useDriverData(params);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const accessToken = await getToken();
      if (!accessToken) return;

      const exportParams = new URLSearchParams();
      if (params.search) exportParams.set('search', params.search);
      if (params.vehicleType) exportParams.set('vehicleType', params.vehicleType);
      if (params.verified) exportParams.set('verified', params.verified);
      if (params.available) exportParams.set('available', params.available);
      if (params.affiliation) exportParams.set('affiliation', params.affiliation);
      if (params.carrierId) exportParams.set('carrierId', params.carrierId);
      exportParams.set('pageSize', '10000');
      exportParams.set('page', '1');

      const url = `${API_URL}/api/v1/admin/drivers?${exportParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return;

      const body = await response.json();
      if (body.data && body.data.length > 0) {
        exportDriversCsv(body.data);
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
          <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
          <p className="text-sm text-muted-foreground">
            View and manage driver accounts, verification status, and performance
          </p>
        </div>

        {/* Toolbar */}
        <DriverToolbar
          search={params.search}
          onSearchChange={setSearch}
          vehicleType={params.vehicleType}
          onVehicleTypeChange={setVehicleType}
          verified={params.verified}
          onVerifiedChange={setVerified}
          available={params.available}
          onAvailableChange={setAvailable}
          affiliation={params.affiliation}
          onAffiliationChange={setAffiliation}
          onExport={handleExport}
          isExporting={isExporting}
        />

        {/* Data table */}
        <DriverDataTable
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
        <DriverPagination
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

function exportDriversCsv(data: Array<Record<string, unknown>>) {
  const headers = [
    'Name',
    'Phone',
    'Email',
    'Vehicle Type',
    'License Plate',
    'Vehicle Model',
    'Verified',
    'Available',
    'Rating',
    'Total Deliveries',
    'Carrier',
    'Joined',
  ];
  const rows = data.map((d) => [
    d.name ?? '',
    d.phone ?? '',
    d.email ?? '',
    d.vehicleType ?? '',
    d.licensePlate ?? '',
    d.vehicleModel ?? '',
    d.verified ? 'Yes' : 'No',
    d.available ? 'Yes' : 'No',
    String(d.rating ?? 0),
    String(d.totalDeliveries ?? 0),
    d.carrierName ?? 'Independent',
    d.createdAt ?? '',
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `surewaka-drivers-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DriversRoute() {
  return (
    <DriversErrorBoundary>
      <DriversPage />
    </DriversErrorBoundary>
  );
}
