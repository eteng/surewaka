import type { DriverDetailDelivery } from '@surewaka/shared';
import { Package } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { formatDate, formatNaira } from '~/lib/format';

type DeliveriesTabProps = {
  deliveries: DriverDetailDelivery[];
};

const statusStyles: Record<string, string> = {
  delivered: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  cancelled: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
  in_transit: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  picked_up: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800',
};

function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800';
  const label = status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Badge variant="outline" className={style}>
      {label}
    </Badge>
  );
}

export function DeliveriesTab({ deliveries }: DeliveriesTabProps) {
  if (deliveries.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Package className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-4 text-sm text-muted-foreground">
            No deliveries have been completed yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Deliveries</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Pickup Address</TableHead>
              <TableHead>Dropoff Address</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((delivery) => (
              <TableRow key={delivery.id}>
                <TableCell>
                  <StatusBadge status={delivery.status} />
                </TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {delivery.pickupAddress}
                </TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {delivery.dropoffAddress}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {formatDate(delivery.date)}
                </TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {formatNaira(delivery.price)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
