import { Package } from 'lucide-react';
import { EmptyState } from '~/components/empty-state';
import type { Route } from './+types/deliveries';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Deliveries' }];
}

export default function Deliveries() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Deliveries</h1>
      <p className="mt-2 text-muted-foreground">Manage all delivery requests</p>

      <div className="mt-8">
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          heading="No deliveries yet"
          body="Delivery requests from the customer app will appear here. Real-time tracking is coming in the next release."
        />
      </div>
    </div>
  );
}
