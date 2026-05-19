import type { Route } from './+types/settings';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Settings' }];
}

export default function Settings() {
  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform configuration and admin preferences
      </p>

      <div className="mt-6 min-h-[60vh] rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Settings panel coming soon.</p>
      </div>
    </div>
  );
}
