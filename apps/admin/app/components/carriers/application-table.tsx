import { useNavigate } from 'react-router';
import type { CarrierApplicationListItem } from '@surewaka/shared';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  under_review: { label: 'Under Review', variant: 'default' },
  approved: { label: 'Approved', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

type ApplicationTableProps = {
  applications: CarrierApplicationListItem[];
  isLoading: boolean;
};

export function ApplicationTable({ applications, isLoading }: ApplicationTableProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        No applications found.
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="py-3 text-left font-medium">Business</th>
          <th className="py-3 text-left font-medium">Contact</th>
          <th className="py-3 text-left font-medium">Fleet</th>
          <th className="py-3 text-left font-medium">Service Areas</th>
          <th className="py-3 text-left font-medium">Status</th>
          <th className="py-3 text-left font-medium">Submitted</th>
        </tr>
      </thead>
      <tbody>
        {applications.map((app) => {
          const statusConfig = STATUS_LABELS[app.status] ?? { label: app.status, variant: 'secondary' as const };
          return (
            <tr
              key={app.id}
              className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate(`/carriers/applications/${app.id}`)}
            >
              <td className="py-3 font-medium">{app.businessName}</td>
              <td className="py-3 text-muted-foreground">
                <div>{app.contactName}</div>
                <div className="text-xs">{app.email}</div>
              </td>
              <td className="py-3">{app.fleetSize ?? '—'}</td>
              <td className="py-3">
                <div className="flex flex-wrap gap-1">
                  {app.serviceAreas.slice(0, 3).map((area) => (
                    <span key={area} className="text-xs bg-muted px-1.5 py-0.5 rounded">{area}</span>
                  ))}
                  {app.serviceAreas.length > 3 && (
                    <span className="text-xs text-muted-foreground">+{app.serviceAreas.length - 3}</span>
                  )}
                </div>
              </td>
              <td className="py-3">
                <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
              </td>
              <td className="py-3 text-muted-foreground">
                {new Date(app.createdAt).toLocaleDateString('en-NG')}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
