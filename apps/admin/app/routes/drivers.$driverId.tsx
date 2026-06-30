import { Component } from 'react';
import type { ReactNode } from 'react';
import { useParams, Link } from 'react-router';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useDriverDetail } from '~/hooks/use-driver-detail';
import { useProfile } from '~/hooks/use-profile';
import { OverviewTab } from '~/components/drivers/detail/overview-tab';
import { DeliveriesTab } from '~/components/drivers/detail/deliveries-tab';
import { CarrierTab } from '~/components/drivers/detail/carrier-tab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/tabs';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export function meta() {
  return [{ title: 'SureWaka Admin - Driver Detail' }];
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class DriverDetailErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
      <Skeleton className="h-5 w-32" />

      {/* Page title */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Tabs */}
      <Skeleton className="h-9 w-72" />

      {/* Tab content - Overview card */}
      <div className="rounded-lg border p-6">
        <div className="flex items-start gap-6">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>

      {/* Vehicle info card */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>

      {/* Status card */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-4 w-24 mb-4" />
        <div className="flex gap-3">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function DriverDetailPage() {
  const { driverId } = useParams();
  const { profile, isLoading: profileLoading } = useProfile();
  const { driver, isLoading, error, refetch } = useDriverDetail(driverId ?? '');

  if (profileLoading || isLoading) {
    return <LoadingSkeleton />;
  }

  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  // Error state — network/server error with Retry
  if (error) {
    const isNotFound =
      error.toLowerCase().includes('not found') || error.includes('404');

    if (isNotFound) {
      return (
        <div className="flex flex-col gap-6">
          <Link
            to="/drivers"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Drivers
          </Link>
          <div className="flex flex-col items-center justify-center rounded-lg border py-16">
            <h2 className="mb-2 text-lg font-semibold">Driver not found</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The driver you are looking for does not exist or has been removed.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/drivers">Back to Drivers</Link>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/drivers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Drivers
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Failed to load driver</h2>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Not found state — no error but no driver data
  if (!driver) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/drivers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Drivers
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Driver not found</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            The driver you are looking for does not exist or has been removed.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/drivers">Back to Drivers</Link>
          </Button>
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
        <Link
          to="/drivers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Drivers
        </Link>

        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{driver.name}</h1>
          <p className="text-sm text-muted-foreground">Driver detail profile</p>
        </div>

        {/* Tabbed layout */}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
            <TabsTrigger value="carrier">Carrier</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab driver={driver} />
          </TabsContent>
          <TabsContent value="deliveries">
            <DeliveriesTab deliveries={driver.recentDeliveries} />
          </TabsContent>
          <TabsContent value="carrier">
            <CarrierTab driver={driver} />
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}

// ─── Route Export ─────────────────────────────────────────────────────────────

export default function DriverDetailRoute() {
  return (
    <DriverDetailErrorBoundary>
      <DriverDetailPage />
    </DriverDetailErrorBoundary>
  );
}
