import { Building2, Send, Truck, TrendingUp, Users } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';

type WaitlistStatsCardsProps = {
  stats: {
    total: number;
    bySender: number;
    byBusiness: number;
    byDriver: number;
    last7Days: number;
  } | null;
  isLoading: boolean;
};

type StatCardProps = {
  label: string;
  value: number;
  icon: React.ReactNode;
};

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-2 h-8 w-16" />
    </div>
  );
}

export function WaitlistStatsCards({ stats, isLoading }: WaitlistStatsCardsProps) {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      <StatCard
        label="Total Signups"
        value={stats.total}
        icon={<Users className="h-4 w-4" />}
      />
      <StatCard
        label="Senders"
        value={stats.bySender}
        icon={<Send className="h-4 w-4" />}
      />
      <StatCard
        label="Businesses"
        value={stats.byBusiness}
        icon={<Building2 className="h-4 w-4" />}
      />
      <StatCard
        label="Drivers"
        value={stats.byDriver}
        icon={<Truck className="h-4 w-4" />}
      />
      <StatCard
        label="Last 7 Days"
        value={stats.last7Days}
        icon={<TrendingUp className="h-4 w-4" />}
      />
    </div>
  );
}
