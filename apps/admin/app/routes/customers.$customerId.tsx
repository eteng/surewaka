import { Component } from 'react';
import type { ReactNode } from 'react';
import { useParams, Link } from 'react-router';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useCustomerDetail } from '~/hooks/use-customer-detail';
import { useProfile } from '~/hooks/use-profile';
import { ProfileHeader } from '~/components/customers/detail/profile-header';
import { StatCards } from '~/components/customers/detail/stat-cards';
import { DeliveryHistoryTable } from '~/components/customers/detail/delivery-history-table';
import { CustomerDetailSkeleton } from '~/components/customers/detail/customer-detail-skeleton';
import { CustomerInfoPanel } from '~/components/customers/detail/customer-info-panel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/tabs';
import { Button } from '~/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export function meta() {
  return [{ title: 'SureWaka Admin - Customer Detail' }];
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class CustomerDetailErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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

// ─── Main Page ────────────────────────────────────────────────────────────────

function CustomerDetailPage() {
  const { customerId } = useParams();
  const { profile, isLoading: profileLoading } = useProfile();
  const { customer, isLoading, error, refetch } = useCustomerDetail(customerId ?? '');

  if (profileLoading || isLoading) {
    return <CustomerDetailSkeleton />;
  }

  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  // Error state — network/server error with Retry
  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Customers
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Failed to load customer</h2>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Not found state — no error but no customer data
  if (!customer) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Customers
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Customer not found</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            The customer you are looking for does not exist or has been removed.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/customers">Back to Customers</Link>
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
          to="/customers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Customers
        </Link>

        {/* Profile header */}
        <ProfileHeader customer={customer} />

        {/* Stat cards */}
        <StatCards customer={customer} />

        {/* Tabbed content */}
        <Tabs defaultValue="deliveries">
          <TabsList>
            <TabsTrigger value="deliveries">Delivery History</TabsTrigger>
            <TabsTrigger value="info">Customer Info</TabsTrigger>
          </TabsList>
          <TabsContent value="deliveries">
            <DeliveryHistoryTable customerId={customer.id} />
          </TabsContent>
          <TabsContent value="info">
            <CustomerInfoPanel customer={customer} />
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}

// ─── Route Export ─────────────────────────────────────────────────────────────

export default function CustomerDetailRoute() {
  return (
    <CustomerDetailErrorBoundary>
      <CustomerDetailPage />
    </CustomerDetailErrorBoundary>
  );
}
