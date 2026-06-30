import { ArrowUpRight, Building2, ClipboardList, Package, Users } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { useDashboardStats } from '~/hooks/use-dashboard-stats';
import type { Route } from './+types/dashboard';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Dashboard' }];
}

export default function Dashboard() {
  const { stats, isLoading, error } = useDashboardStats();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">SureWaka operations overview</p>

      {error && (
        <p className="mt-4 text-sm text-destructive">Failed to load stats: {error}</p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending Applications"
          value={stats?.pendingApplications}
          delta={stats?.pendingApplicationsDelta}
          icon={<ClipboardList className="h-4 w-4" />}
          isLoading={isLoading}
          href="/carriers/applications"
        />
        <StatCard
          label="Approved Carriers"
          value={stats?.approvedCarriers}
          delta={stats?.approvedCarriersDelta}
          icon={<Building2 className="h-4 w-4" />}
          isLoading={isLoading}
          href="/carriers"
        />
        <StatCard
          label="Total Deliveries"
          value={stats?.totalDeliveries}
          delta={stats?.deliveriesDelta}
          icon={<Package className="h-4 w-4" />}
          isLoading={isLoading}
          href="/deliveries"
        />
        <StatCard
          label="Waitlist Signups"
          value={stats?.waitlistTotal}
          delta={stats?.waitlistDelta}
          icon={<Users className="h-4 w-4" />}
          isLoading={isLoading}
          href="/waitlist"
        />
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: number | undefined;
  delta: number | undefined;
  icon: React.ReactNode;
  isLoading: boolean;
  href: string;
};

function StatCard({ label, value, delta, icon, isLoading, href }: StatCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="mt-3 h-9 w-16" />
        <Skeleton className="mt-2 h-4 w-24" />
      </div>
    );
  }

  return (
    <a
      href={href}
      className="block rounded-lg border border-border p-6 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-sm font-medium">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-bold text-foreground">
        {value?.toLocaleString() ?? '—'}
      </p>
      <DeltaBadge delta={delta} />
    </a>
  );
}

function DeltaBadge({ delta }: { delta: number | undefined }) {
  if (delta === undefined) return null;

  if (delta === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">No change this week</p>;
  }

  return (
    <p className="mt-2 flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
      <ArrowUpRight className="h-3 w-3" />
      +{delta.toLocaleString()} this week
    </p>
  );
}
