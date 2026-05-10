import type { Route } from './+types/dashboard';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Dashboard' }];
}

export default function Dashboard() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">SureWaka operations overview</p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Deliveries" value="0" />
        <StatCard label="Drivers Online" value="0" />
        <StatCard label="Today's Revenue" value="₦0" />
        <StatCard label="Pending Verifications" value="0" />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
    </div>
  );
}
