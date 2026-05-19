import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useEmployeeParams } from '~/hooks/use-employee-params';
import { useEmployeeData } from '~/hooks/use-employee-data';
import { useProfile } from '~/hooks/use-profile';
import { EmployeeToolbar } from '~/components/users/employee-toolbar';
import { EmployeeDataTable } from '~/components/users/employee-data-table';
import { EmployeePagination } from '~/components/users/employee-pagination';
import { InviteDialog } from '~/components/users/invite-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';

export function meta() {
  return [{ title: 'SureWaka Admin - User Management' }];
}

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class UsersErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
        {Array.from({ length: 5 }).map((_, i) => (
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

function UsersPage() {
  const { profile, isLoading: profileLoading } = useProfile();
  const {
    params,
    setPage,
    setPageSize,
    setSearch,
    setRole,
    setStatus,
    toggleSort,
  } = useEmployeeParams();

  const { data, meta, isLoading, error, refetch } = useEmployeeData(params);
  const [inviteOpen, setInviteOpen] = useState(false);

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
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage employees, invite new team members, and control access
          </p>
        </div>

        {/* Toolbar */}
        <EmployeeToolbar
          search={params.search}
          onSearchChange={setSearch}
          role={params.role}
          onRoleChange={setRole}
          status={params.status}
          onStatusChange={setStatus}
          onInviteClick={() => setInviteOpen(true)}
        />

        {/* Data table */}
        <EmployeeDataTable
          data={data}
          sortBy={params.sortBy}
          sortDir={params.sortDir}
          onSort={toggleSort}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
        />

        {/* Pagination */}
        <EmployeePagination
          page={params.page}
          pageSize={params.pageSize}
          total={meta?.total ?? 0}
          totalPages={meta?.totalPages ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />

        {/* Invite dialog */}
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onSuccess={refetch}
        />
      </div>
    </RoleGate>
  );
}

export default function UsersRoute() {
  return (
    <UsersErrorBoundary>
      <UsersPage />
    </UsersErrorBoundary>
  );
}
