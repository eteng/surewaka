import type { DeliveryListItem, DeliveryStatus } from '@surewaka/shared';
import { cn } from '~/lib/utils';

type DeliveryRowProps = {
  delivery: DeliveryListItem;
  onClick: (deliveryId: string) => void;
  onHover?: (deliveryId: string | null) => void;
  showElapsedTime?: boolean;
};

/**
 * Maps each delivery status to its corresponding badge color classes.
 * Requirement 9.12: Distinct status badges/color coding.
 */
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

/** Formats status by replacing underscores with spaces and capitalizing first letter. */
function formatStatus(status: DeliveryStatus): string {
  return status
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Formats price with Naira symbol and commas (e.g., ₦2,500.00). */
function formatPrice(price: number | null): string {
  if (price == null) return '—';
  return `₦${price.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formats date to short format (e.g., "Jan 15, 2025"). */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Formats elapsed time since creation.
 * - Under 24h: "Xh Ym"
 * - 24h or more: "Xd Yh"
 * Requirement 9.13.
 */
export function formatElapsedTime(createdAt: string, now?: Date): string {
  const created = new Date(createdAt);
  const current = now ?? new Date();
  const diffMs = current.getTime() - created.getTime();

  if (diffMs < 0) return '0h 0m';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return `${totalHours}h ${minutes}m`;
  }

  const remainingHours = totalHours % 24;
  return `${totalDays}d ${remainingHours}h`;
}

function StatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        getStatusBadgeClasses(status),
      )}
    >
      {formatStatus(status)}
    </span>
  );
}

export function DeliveryRow({
  delivery,
  onClick,
  onHover,
  showElapsedTime,
}: DeliveryRowProps) {
  return (
    <tr
      className="cursor-pointer border-b transition-colors hover:bg-muted/50"
      onClick={() => onClick(delivery.id)}
      onMouseEnter={() => onHover?.(delivery.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Tracking reference — first 8 chars of UUID in monospace font */}
      <td className="p-3 font-mono text-xs">{delivery.id.slice(0, 8)}</td>

      {/* Customer name */}
      <td className="p-3">{delivery.customerName}</td>

      {/* Pickup city */}
      <td className="p-3">{delivery.pickupCity}</td>

      {/* Dropoff city */}
      <td className="p-3">{delivery.dropoffCity}</td>

      {/* Status badge */}
      <td className="p-3">
        <StatusBadge status={delivery.status} />
      </td>

      {/* Requests tab: elapsed time + package category */}
      {/* Other tabs: package category + price + creation date */}
      {showElapsedTime ? (
        <>
          <td className="p-3 text-sm text-muted-foreground">
            {formatElapsedTime(delivery.createdAt)}
          </td>
          <td className="p-3 capitalize">{delivery.packageCategory}</td>
        </>
      ) : (
        <>
          <td className="p-3 capitalize">{delivery.packageCategory}</td>
          <td className="p-3 text-right">{formatPrice(delivery.price)}</td>
          <td className="p-3 text-sm text-muted-foreground">{formatDate(delivery.createdAt)}</td>
        </>
      )}
    </tr>
  );
}
