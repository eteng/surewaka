import type { Route } from './+types/disputes';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Disputes' }];
}

export default function Disputes() {
  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Disputes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Handle delivery disputes and customer complaints
      </p>

      <div className="mt-6 min-h-[60vh] rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Dispute management coming soon.</p>
      </div>
    </div>
  );
}
