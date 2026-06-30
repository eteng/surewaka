import type { DriverDetail } from '@surewaka/shared';
import { Badge } from '~/components/ui/badge';
import { Building2, Calendar, UserCog } from 'lucide-react';

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type CarrierTabProps = {
  driver: DriverDetail;
};

export function CarrierTab({ driver }: CarrierTabProps) {
  const isIndependent = driver.carrierName === null;

  if (isIndependent) {
    return (
      <div className="rounded-lg border p-6">
        <h3 className="text-lg font-semibold">Carrier Affiliation</h3>
        <div className="flex items-center gap-3 pt-4">
          <Badge variant="secondary">Independent</Badge>
          <span className="text-sm text-muted-foreground">
            This driver operates independently without a carrier.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-6">
      <h3 className="text-lg font-semibold">Carrier Affiliation</h3>
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <Building2 className="size-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Carrier</p>
            <p className="text-sm font-medium">{driver.carrierName}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <UserCog className="size-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Role</p>
            <p className="text-sm font-medium capitalize">{driver.carrierRole}</p>
          </div>
        </div>

        {driver.carrierJoinedAt && (
          <div className="flex items-center gap-3">
            <Calendar className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Joined Carrier</p>
              <p className="text-sm font-medium">{formatDate(driver.carrierJoinedAt)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
