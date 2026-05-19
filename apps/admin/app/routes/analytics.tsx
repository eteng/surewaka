import type { Route } from './+types/analytics';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Analytics' }];
}

export default function Analytics() {
  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform metrics and business intelligence
      </p>

      <div className="mt-6 grid auto-rows-min gap-4 md:grid-cols-2">
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
      </div>
      <div className="mt-4 min-h-[40vh] rounded-xl bg-muted/50" />
    </div>
  );
}
