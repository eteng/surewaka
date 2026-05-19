import type { Route } from './+types/verifications';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Verifications' }];
}

export default function Verifications() {
  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Verifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Review and approve driver/carrier KYC documents
      </p>

      <div className="mt-6 min-h-[60vh] rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Verification queue coming soon.</p>
      </div>
    </div>
  );
}
