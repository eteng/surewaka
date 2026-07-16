import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Truck, X } from 'lucide-react';
import type { DeliveryDetail, DeliveryStatus, DeliveryEventWithActor } from '@surewaka/shared';
import { createAblyProvider, CHANNELS, EVENTS } from '@surewaka/realtime';
import type { Unsubscribe } from '@surewaka/realtime';
import type { StatusUpdatePayload, LocationUpdatePayload } from '@surewaka/shared';
import { useDeliveryDetail } from '~/hooks/use-delivery-detail';
import { useDeliveryEvents } from '~/hooks/use-delivery-events';
import { cn } from '~/lib/utils';
import { DetailMap } from './detail-map';
import { DeliveryTimeline } from './delivery-timeline';

export type DetailTab = 'timeline' | 'details';

type DeliveryDetailViewProps = {
  deliveryId: string;
  onClose: () => void;
  tab: DetailTab;
  onTabChange: (t: DetailTab) => void;
};

const TERMINAL_STATUSES: DeliveryStatus[] = ['delivered', 'cancelled', 'failed'];
const ACTIVE_STATUSES: DeliveryStatus[] = [
  'accepted', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff',
];

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatStatus(status: DeliveryStatus): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function getStatusBadgeClasses(status: DeliveryStatus): string {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-700';
    case 'pending': return 'bg-yellow-100 text-yellow-700';
    case 'accepted': return 'bg-blue-100 text-blue-700';
    case 'en_route_pickup':
    case 'arrived_pickup':
    case 'picked_up': return 'bg-orange-100 text-orange-700';
    case 'en_route_dropoff':
    case 'arrived_dropoff': return 'bg-purple-100 text-purple-700';
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'cancelled':
    case 'failed': return 'bg-red-100 text-red-700';
    case 'returned': return 'bg-gray-100 text-gray-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function formatPrice(priceKobo: number | null): string {
  if (priceKobo == null) return '—';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(priceKobo / 100);
}

function formatDateTimeDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day}, ${year} at ${time}`;
}

function minutesSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000);
}

// ─── Risk flag ────────────────────────────────────────────────────────────────
// [S1] Lucide icons replace emoji  [A1] aria-hidden on decorative icons

function RiskFlag({ updatedAt, status }: { updatedAt: string; status: DeliveryStatus }) {
  const [minutes, setMinutes] = useState(() => minutesSince(updatedAt));

  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(status)) return;
    const id = setInterval(() => setMinutes(minutesSince(updatedAt)), 60_000);
    return () => clearInterval(id);
  }, [updatedAt, status]);

  if (!ACTIVE_STATUSES.includes(status) || minutes < 30) return null;

  const isCritical = minutes >= 60;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isCritical
          ? 'bg-destructive/10 text-destructive'
          : 'bg-yellow-100 text-yellow-700',
      )}
    >
      {isCritical
        ? <AlertCircle className="h-3 w-3" aria-hidden="true" />
        : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      Stuck {minutes}m
    </span>
  );
}

// ─── Live dot ─────────────────────────────────────────────────────────────────
// [A3] sr-only label for screen readers  [M1] motion-reduce guard

function LiveDot({ status }: { status: DeliveryStatus }) {
  if (TERMINAL_STATUSES.includes(status)) return null;
  return (
    <span className="relative flex h-2 w-2" aria-label="Live">
      <span className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      <span className="sr-only">Live</span>
    </span>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────
// [A1] tablist/tab roles + aria-selected  [A2] focus-visible ring  [T2] py-3 → ~44px tap target

function TabBar({ active, onChange }: { active: DetailTab; onChange: (t: DetailTab) => void }) {
  return (
    <div className="flex border-b" role="tablist">
      {(['timeline', 'details'] as DetailTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          onClick={() => onChange(tab)}
          className={cn(
            'cursor-pointer px-4 py-3 text-sm font-medium capitalize transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
            active === tab
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
// [M1] motion-reduce guard on animate-pulse

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse motion-reduce:animate-none">
      <div className="flex items-center justify-between">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-8 w-8 bg-muted rounded" />
      </div>
      <div className="h-64 w-full bg-muted rounded-lg" />
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

// ─── Not found ────────────────────────────────────────────────────────────────

function NotFoundState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold">Delivery not found</h3>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        This delivery may have been removed or the ID is invalid.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="cursor-pointer inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Back to deliveries
      </button>
    </div>
  );
}

// ─── Details tab — compact field ─────────────────────────────────────────────
// [C1] text-xs (12px) replaces text-[11px]  [C2] /70 replaces /60 for contrast

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground truncate">{value ?? '—'}</p>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── Details tab content ──────────────────────────────────────────────────────

function DetailsContent({ delivery }: { delivery: DeliveryDetail }) {
  return (
    <div className="space-y-4">
      {/* Customer | Recipient */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-3">
        <DetailSection title="Customer">
          <Field label="Name" value={delivery.customer.name} />
          <Field label="Phone" value={delivery.senderPhone ?? delivery.customer.phone} />
        </DetailSection>
        <DetailSection title="Recipient">
          <Field label="Name" value={delivery.recipientName} />
          <Field label="Phone" value={delivery.recipientPhone} />
        </DetailSection>
      </div>

      {/* Driver | Carrier */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-3">
        <DetailSection title="Driver">
          {delivery.driver ? (
            <>
              <Field label="Name" value={delivery.driver.name} />
              <Field label="Vehicle" value={<span className="capitalize">{delivery.driver.vehicleType}</span>} />
              <Field label="Plate" value={delivery.driver.licensePlate} />
            </>
          ) : (
            <p className="text-sm italic text-muted-foreground">Unassigned</p>
          )}
        </DetailSection>
        <DetailSection title="Carrier">
          {delivery.carrier ? (
            <Field label="Name" value={delivery.carrier.name} />
          ) : (
            <p className="text-sm italic text-muted-foreground">Unassigned</p>
          )}
        </DetailSection>
      </div>

      {/* Pickup | Dropoff */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-3">
        <DetailSection title="Pickup">
          <Field label="Address" value={delivery.pickupAddress} />
          <Field label="City" value={delivery.pickupCity} />
        </DetailSection>
        <DetailSection title="Dropoff">
          <Field label="Address" value={delivery.dropoffAddress} />
          <Field label="City" value={delivery.dropoffCity} />
        </DetailSection>
      </div>

      {/* Package — full width, 2-col grid inside */}
      <div className="border-t pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Package</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Field label="Description" value={delivery.packageDescription} />
          <Field label="Category" value={<span className="capitalize">{delivery.packageCategory}</span>} />
          <Field label="Weight" value={`${delivery.packageWeight} kg`} />
          <Field
            label="Notes"
            value={delivery.deliveryNotes ?? <span className="italic text-muted-foreground">None</span>}
          />
        </div>
      </div>

      {/* Pricing | Timestamps */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-3">
        <DetailSection title="Pricing">
          <Field label="Price" value={formatPrice(delivery.price)} />
          <Field label="Amount Paid" value={formatPrice(delivery.amountPaid)} />
          <Field label="Payment" value={<span className="capitalize">{delivery.paymentStatus}</span>} />
        </DetailSection>
        <DetailSection title="Timestamps">
          <Field label="Created" value={formatDateTimeDisplay(delivery.createdAt)} />
          <Field label="Updated" value={formatDateTimeDisplay(delivery.updatedAt)} />
        </DetailSection>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DeliveryDetailView({ deliveryId, onClose, tab, onTabChange }: DeliveryDetailViewProps) {
  const { data, loading, error, refetch: refetchDetail } = useDeliveryDetail(deliveryId);
  const {
    data: events,
    loading: eventsLoading,
    error: eventsError,
    prepend,
    refetch: refetchEvents,
  } = useDeliveryEvents(deliveryId);
  const [liveStatus, setLiveStatus] = useState<DeliveryStatus | null>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);

  // Reset driver position when switching to a different delivery
  useEffect(() => {
    setDriverPos(null);
  }, [deliveryId]);

  // Realtime subscriptions — status updates + driver location
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const locationUnsubRef = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    if (!data || TERMINAL_STATUSES.includes(data.status)) return;

    const provider = createAblyProvider();
    const channel = CHANNELS.deliveryTracking(deliveryId);

    unsubscribeRef.current = provider.subscribe(
      channel,
      EVENTS.statusUpdate,
      (raw: unknown) => {
        const payload = raw as StatusUpdatePayload;
        if (payload.deliveryId !== deliveryId) return;

        setLiveStatus(payload.newStatus);

        const syntheticEvent: DeliveryEventWithActor = {
          id: `rt-${Date.now()}`,
          deliveryId,
          legId: null,
          fromStatus: payload.previousStatus,
          toStatus: payload.newStatus,
          triggeredBy: null,
          failureCause: null,
          failureNote: null,
          createdAt: payload.timestamp,
          actorName: null,
        };
        prepend(syntheticEvent);

        if (TERMINAL_STATUSES.includes(payload.newStatus)) {
          unsubscribeRef.current?.();
          unsubscribeRef.current = null;
          locationUnsubRef.current?.();
          locationUnsubRef.current = null;
        }
      },
    );

    // Subscribe to driver location updates on the same delivery channel
    locationUnsubRef.current = provider.subscribe(
      channel,
      EVENTS.locationUpdate,
      (raw: unknown) => {
        const payload = raw as LocationUpdatePayload;
        setDriverPos({ lat: payload.lat, lng: payload.lng });
      },
    );

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      locationUnsubRef.current?.();
      locationUnsubRef.current = null;
      provider.close();
    };
  }, [deliveryId, data, prepend]);

  const currentStatus = liveStatus ?? data?.status ?? null;
  const isNotFound = !loading && !data && error?.toLowerCase().includes('not found');

  return (
    <div className="rounded-lg border bg-background shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Truck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Delivery</h2>
          {data && (
            <span className="text-xs text-muted-foreground font-mono">
              #{deliveryId.slice(0, 8)}
            </span>
          )}
          {currentStatus && <LiveDot status={currentStatus} />}
          {currentStatus && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-200',
                getStatusBadgeClasses(currentStatus),
              )}
            >
              {formatStatus(currentStatus)}
            </span>
          )}
          {data && currentStatus && <RiskFlag updatedAt={data.updatedAt} status={currentStatus} />}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Close detail view"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto">
        {loading && <div className="px-5 py-4"><DetailSkeleton /></div>}
        {isNotFound && <div className="px-5 py-4"><NotFoundState onClose={onClose} /></div>}

        {/* [F1] Generic error now has a retry action */}
        {!loading && error && !isNotFound && (
          <div className="flex flex-col items-center gap-3 py-8">
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={refetchDetail}
              className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Map */}
            <div className="px-5 pt-4">
              <DetailMap
                pickupLat={data.pickupLat}
                pickupLng={data.pickupLng}
                dropoffLat={data.dropoffLat}
                dropoffLng={data.dropoffLng}
                hasDriver={data.driver !== null}
                driverLat={driverPos?.lat}
                driverLng={driverPos?.lng}
              />
            </div>

            {/* Tabs */}
            <TabBar active={tab} onChange={onTabChange} />

            <div className="px-5 py-4">
              {tab === 'timeline' && (
                <DeliveryTimeline
                  events={events}
                  loading={eventsLoading}
                  error={eventsError}
                  onRetry={refetchEvents}
                />
              )}
              {tab === 'details' && <DetailsContent delivery={data} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
