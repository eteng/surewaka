import type { DriverDetail } from '@surewaka/shared';
import { Badge } from '~/components/ui/badge';
import { cn } from '~/lib/utils';
import {
  Phone,
  Mail,
  Car,
  FileText,
  Star,
  Package,
  Calendar,
  CheckCircle,
  XCircle,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

type OverviewTabProps = {
  driver: DriverDetail;
};

export function OverviewTab({ driver }: OverviewTabProps) {
  const initials = driver.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col gap-6">
      {/* Personal Information */}
      <div className="rounded-lg border p-6">
        <div className="flex items-start gap-6">
          {/* Avatar */}
          <div className="shrink-0">
            {driver.avatarUrl ? (
              <img
                src={driver.avatarUrl}
                alt={`${driver.name}'s avatar`}
                className="size-20 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-20 items-center justify-center rounded-full bg-muted">
                <span className="text-xl font-semibold text-muted-foreground">{initials}</span>
              </div>
            )}
          </div>

          {/* Name, phone, email */}
          <div className="flex-1 space-y-3">
            <h3 className="text-xl font-semibold">{driver.name}</h3>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="size-4" />
                <span>{driver.phone}</span>
              </div>
              {driver.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="size-4" />
                  <span>{driver.email}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle Details */}
      <div className="rounded-lg border p-6">
        <h4 className="mb-4 text-sm font-medium text-muted-foreground">Vehicle Information</h4>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <Car className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Vehicle Type</p>
              <p className="text-sm font-medium capitalize">{driver.vehicleType}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <FileText className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Model</p>
              <p className="text-sm font-medium">{driver.vehicleModel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <FileText className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">License Plate</p>
              <p className="text-sm font-medium">{driver.licensePlate}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Status Badges */}
      <div className="rounded-lg border p-6">
        <h4 className="mb-4 text-sm font-medium text-muted-foreground">Status</h4>
        <div className="flex flex-wrap gap-3">
          <Badge
            className={cn(
              driver.verified
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
              'border-transparent',
            )}
          >
            {driver.verified ? (
              <CheckCircle className="mr-1 size-3" />
            ) : (
              <XCircle className="mr-1 size-3" />
            )}
            {driver.verified ? 'Verified' : 'Unverified'}
          </Badge>

          <Badge
            className={cn(
              driver.available
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
              'border-transparent',
            )}
          >
            {driver.available ? 'Available' : 'Unavailable'}
          </Badge>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="rounded-lg border p-6">
        <h4 className="mb-4 text-sm font-medium text-muted-foreground">Performance</h4>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <Star className="size-4 text-yellow-500" />
            <div>
              <p className="text-xs text-muted-foreground">Rating</p>
              <p className="text-sm font-medium">{driver.rating.toFixed(1)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Package className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Total Deliveries</p>
              <p className="text-sm font-medium">{driver.totalDeliveries}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Calendar className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Joined</p>
              <p className="text-sm font-medium">{formatDate(driver.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
