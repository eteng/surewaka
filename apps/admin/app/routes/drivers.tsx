import type { Route } from './+types/drivers';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Drivers' }];
}

export default function Drivers() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Drivers</h1>
      <p className="mt-2 text-muted-foreground">Manage driver accounts and verifications</p>
      {/* TODO: Driver list with KYC status */}
    </div>
  );
}
