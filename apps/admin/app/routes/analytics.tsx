import { BarChart3 } from 'lucide-react';
import { EmptyState } from '~/components/empty-state';
import type { Route } from './+types/analytics';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Analytics' }];
}

export default function Analytics() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
      <p className="mt-2 text-muted-foreground">Platform metrics and business intelligence</p>

      <div className="mt-8">
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          heading="Analytics coming soon"
          body="Revenue trends, delivery performance, and growth metrics will appear here. For now, check the Waitlist page for current growth data."
          action={{ label: 'View waitlist', href: '/waitlist' }}
        />
      </div>
    </div>
  );
}
