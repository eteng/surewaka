import { AlertCircle, Truck, X } from 'lucide-react';
import type { DeliveryDetail, DeliveryStatus } from '@surewaka/shared';
import { useDeliveryDetail } from '~/hooks/use-delivery-detail';
import { cn } from '~/lib/utils';
import { DetailMap } from './detail-map';

type DeliveryDetailViewProps = {
  deliveryId: string;
  onClose: () => void;
};

// --- Formatting Helpers ---

function formatStatus(status: DeliveryStatus): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function getStatusBadgeClasses(status: DeliveryStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-700';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    case 'accepted':
      return 'bg-blue-100 text-blue-700';
    case 'en_route_pickup':
    case 'arrived_pickup':
    case 'picked_up':
      return 'bg-orange-100 text-orange-700';
    case 'en_route_dropoff':
    case 'arrived_dropoff':
      return 'bg-purple-100 text-purple-700';
    case 'delivered':
      return 'bg-green-100 text-green-700';
    case 'cancelled':
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'returned':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function formatPrice(price: number | null): string {
  if (price == null) return '—';
  return `₦${price.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats a date string as "Jan 15, 2025 at 10:30 AM".
 */
function formatDateTimeDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${month} ${day}, ${year} at ${time}`;
}

// --- Sub-Components ---

function StatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        getStatusBadgeClasses(status),
      )}
    >
      {formatStatus(status)}
    </span>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%]">{value ?? '—'}</span>
    </div>
  );
}

// --- Loading Skeleton ---

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-8 w-8 bg-muted rounded" />
      </div>

      {/* Map skeleton */}
      <div className="h-48 w-full bg-muted rounded-lg" />

      {/* Sections skeleton */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-3 border-t pt-4">
          <div className="h-3 w-24 bg-muted rounded" />
          <div className="space-y-2">
            <div className="flex justify-between">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
            <div className="flex justify-between">
              <div className="h-4 w-16 bg-muted rounded" />
              <div className="h-4 w-28 bg-muted rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- 404 State ---

function NotFoundState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold">Delivery not found</h3>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        This delivery may have been removed or the ID is invalid.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="cursor-pointer inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Back to deliveries
      </button>
    </div>
  );
}

// --- Detail Content ---

function DetailContent({ delivery }: { delivery: DeliveryDetail }) {
  return (
    <div className="space-y-5">
      {/* Map */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <DetailMap
          pickupLat={delivery.pickupLat}
          pickupLng={delivery.pickupLng}
          dropoffLat={delivery.dropoffLat}
          dropoffLng={delivery.dropoffLng}
          hasDriver={delivery.driver !== null}
        />
      </div>

      {/* Customer Section */}
      <section className="border-t pt-4">
        <SectionHeader>Customer</SectionHeader>
        <InfoRow label="Name" value={delivery.customer.name} />
        <InfoRow label="Sender Phone" value={delivery.senderPhone ?? delivery.customer.phone} />
      </section>

      {/* Recipient Section */}
      <section className="border-t pt-4">
        <SectionHeader>Recipient</SectionHeader>
        <InfoRow label="Name" value={delivery.recipientName} />
        <InfoRow label="Phone" value={delivery.recipientPhone} />
      </section>

      {/* Driver Section */}
      <section className="border-t pt-4">
        <SectionHeader>Driver</SectionHeader>
        {delivery.driver ? (
          <>
            <InfoRow label="Name" value={delivery.driver.name} />
            <InfoRow label="Vehicle" value={delivery.driver.vehicleType} />
            <InfoRow label="Plate" value={delivery.driver.licensePlate} />
          </>
        ) : (
          <InfoRow label="Name" value={<span className="italic text-muted-foreground">Unassigned</span>} />
        )}
      </section>

      {/* Carrier Section */}
      <section className="border-t pt-4">
        <SectionHeader>Carrier</SectionHeader>
        {delivery.carrier ? (
          <InfoRow label="Name" value={delivery.carrier.name} />
        ) : (
          <InfoRow label="Name" value={<span className="italic text-muted-foreground">Unassigned</span>} />
        )}
      </section>

      {/* Pickup Section */}
      <section className="border-t pt-4">
        <SectionHeader>Pickup</SectionHeader>
        <InfoRow label="Address" value={delivery.pickupAddress} />
        <InfoRow label="City" value={delivery.pickupCity} />
      </section>

      {/* Dropoff Section */}
      <section className="border-t pt-4">
        <SectionHeader>Dropoff</SectionHeader>
        <InfoRow label="Address" value={delivery.dropoffAddress} />
        <InfoRow label="City" value={delivery.dropoffCity} />
      </section>

      {/* Package Section */}
      <section className="border-t pt-4">
        <SectionHeader>Package</SectionHeader>
        <InfoRow label="Description" value={delivery.packageDescription} />
        <InfoRow label="Weight" value={`${delivery.packageWeight} kg`} />
        <InfoRow label="Category" value={<span className="capitalize">{delivery.packageCategory}</span>} />
        <InfoRow
          label="Delivery Notes"
          value={delivery.deliveryNotes ?? <span className="italic text-muted-foreground">None</span>}
        />
      </section>

      {/* Pricing Section */}
      <section className="border-t pt-4">
        <SectionHeader>Pricing</SectionHeader>
        <InfoRow label="Price" value={formatPrice(delivery.price)} />
        <InfoRow label="Amount Paid" value={formatPrice(delivery.amountPaid)} />
        <InfoRow
          label="Payment Status"
          value={<span className="capitalize">{delivery.paymentStatus}</span>}
        />
      </section>

      {/* Status Section */}
      <section className="border-t pt-4">
        <SectionHeader>Status</SectionHeader>
        <div className="flex items-start justify-between py-1.5">
          <span className="text-sm text-muted-foreground">Current Status</span>
          <StatusBadge status={delivery.status} />
        </div>
        <InfoRow label="Created" value={formatDateTimeDisplay(delivery.createdAt)} />
        <InfoRow label="Last Updated" value={formatDateTimeDisplay(delivery.updatedAt)} />
      </section>
    </div>
  );
}



// --- Main Component ---

export function DeliveryDetailView({ deliveryId, onClose }: DeliveryDetailViewProps) {
  const { data, loading, error } = useDeliveryDetail(deliveryId);

  // Determine if it's a 404 (delivery not found)
  const isNotFound = !loading && !data && error?.toLowerCase().includes('not found');

  return (
    <div className="rounded-lg border bg-background shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Delivery Detail</h2>
          {data && (
            <span className="text-xs text-muted-foreground font-mono">
              #{deliveryId.slice(0, 8)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close detail view"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-5 py-4">
        {loading && <DetailSkeleton />}

        {isNotFound && <NotFoundState onClose={onClose} />}

        {!loading && error && !isNotFound && (
          <div className="flex flex-col items-center gap-3 py-8">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && data && <DetailContent delivery={data} />}
      </div>
    </div>
  );
}
