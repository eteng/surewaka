import { Component } from 'react';
import type { ReactNode } from 'react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useProfile } from '~/hooks/use-profile';
import { DeliveriesPage } from '~/components/deliveries/deliveries-page';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import type { Route } from './+types/deliveries';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Deliveries' }];
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class DeliveriesErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
            {this.state.error?.message || 'An unexpected error occurred while loading deliveries.'}
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

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

// ─── Route Component ─────────────────────────────────────────────────────────

function DeliveriesContent() {
  const { profile, isLoading: profileLoading } = useProfile();

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
      <DeliveriesPage />
    </RoleGate>
  );
}

export default function DeliveriesRoute() {
  return (
    <DeliveriesErrorBoundary>
      <DeliveriesContent />
    </DeliveriesErrorBoundary>
  );
}
