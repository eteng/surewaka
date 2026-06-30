import { MessageSquare } from 'lucide-react';
import { EmptyState } from '~/components/empty-state';
import type { Route } from './+types/disputes';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Disputes' }];
}

export default function Disputes() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Disputes</h1>
      <p className="mt-2 text-muted-foreground">Handle delivery disputes and customer complaints</p>

      <div className="mt-8">
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          heading="No open disputes"
          body="Customer disputes and escalations will appear here once the support workflow is enabled."
        />
      </div>
    </div>
  );
}
