import type { Route } from './+types/deliveries';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Deliveries' }];
}

export default function Deliveries() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Deliveries</h1>
      <p className="mt-2 text-muted-foreground">Manage all delivery requests</p>
      {/* TODO: Delivery table with filters */}
    </div>
  );
}
