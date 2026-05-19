import { Component } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useEmployeeDetail } from '~/hooks/use-employee-detail';
import { useProfile } from '~/hooks/use-profile';
import { RoleAssignmentPanel } from '~/components/users/role-assignment-panel';
import { AuditHistory } from '~/components/users/audit-history';
import { EmployeeActions } from '~/components/users/employee-actions';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { ArrowLeft, Mail, Phone, Calendar, Clock, User } from 'lucide-react';
import { cn } from '~/lib/utils';

export function meta() {
  return [{ title: 'SureWaka Admin - Employee Detail' }];
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class EmployeeDetailErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Skeleton className="h-5 w-24" />

      {/* Profile card */}
      <div className="rounded-lg border p-6">
        <div className="flex items-start gap-6">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-4 pt-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
        </div>
      </div>

      {/* Role panel */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-6 w-24" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>

      {/* Audit history */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-6 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Profile Section ──────────────────────────────────────────────────────────

type ProfileSectionProps = {
  employee: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    verified: boolean;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

function ProfileSection({ employee }: ProfileSectionProps) {
  const initials = employee.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="rounded-lg border p-6">
      <div className="flex items-start gap-6">
        {/* Avatar */}
        <div className="shrink-0">
          {employee.avatarUrl ? (
            <img
              src={employee.avatarUrl}
              alt={`${employee.name}'s avatar`}
              className="size-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-full bg-muted">
              <span className="text-xl font-semibold text-muted-foreground">
                {initials}
              </span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">{employee.name}</h2>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                employee.verified
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
              )}
            >
              {employee.verified ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4" />
              <span>{employee.email}</span>
            </div>
            {employee.phone && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="size-4" />
                <span>{employee.phone}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              <span>Created {formatDate(employee.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              <span>Updated {formatDateTime(employee.updatedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="size-3.5" />
              <span>ID: {employee.id.slice(0, 8)}...</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function EmployeeDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading } = useProfile();
  const {
    employee,
    auditLog,
    auditLogMeta,
    isLoading,
    error,
    refetch,
    mutations,
  } = useEmployeeDetail(userId ?? '');

  if (profileLoading || isLoading) {
    return <LoadingSkeleton />;
  }

  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <button
          onClick={() => navigate('/users')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Users
        </button>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Failed to load employee</h2>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex flex-col gap-6">
        <button
          onClick={() => navigate('/users')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Users
        </button>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Employee not found</h2>
          <p className="text-sm text-muted-foreground">
            The employee you are looking for does not exist or has been removed.
          </p>
        </div>
      </div>
    );
  }

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
        {/* Back link */}
        <button
          onClick={() => navigate('/users')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Users
        </button>

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{employee.name}</h1>
            <p className="text-sm text-muted-foreground">Employee profile and role management</p>
          </div>
          <EmployeeActions
            employeeId={employee.id}
            isActive={employee.verified}
            currentUserId={profile?.id ?? ''}
            onDeactivate={mutations.deactivate}
            onReactivate={mutations.reactivate}
          />
        </div>

        {/* Profile section */}
        <ProfileSection employee={employee} />

        {/* Role Assignment Panel */}
        <div className="rounded-lg border p-6">
          <RoleAssignmentPanel
            userId={employee.id}
            activeRoles={employee.roles}
            carriers={employee.carriers}
            onAssignRole={mutations.assignRole}
            onRevokeRole={mutations.revokeRole}
          />
        </div>

        {/* Audit History */}
        <div className="rounded-lg border p-6">
          <AuditHistory
            entries={auditLog}
            meta={auditLogMeta}
            isLoading={isLoading}
          />
        </div>
      </div>
    </RoleGate>
  );
}

// ─── Route Export ─────────────────────────────────────────────────────────────

export default function EmployeeDetailRoute() {
  return (
    <EmployeeDetailErrorBoundary>
      <EmployeeDetailPage />
    </EmployeeDetailErrorBoundary>
  );
}
