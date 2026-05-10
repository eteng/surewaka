import type { Route } from './+types/carriers';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Carriers' }];
}

export default function Carriers() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Carriers</h1>
      <p className="mt-2 text-muted-foreground">Manage registered logistics companies</p>
      {/* TODO: Carrier list with verification status */}
    </div>
  );
}
