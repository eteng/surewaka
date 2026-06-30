import { ShieldCheck } from 'lucide-react';
import { EmptyState } from '~/components/empty-state';
import type { Route } from './+types/verifications';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Verifications' }];
}

export default function Verifications() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Verifications</h1>
      <p className="mt-2 text-muted-foreground">Review and approve driver and carrier KYC documents</p>

      <div className="mt-8">
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          heading="Verification queue is empty"
          body="KYC documents submitted by drivers and carriers will appear here for review and approval."
        />
      </div>
    </div>
  );
}
