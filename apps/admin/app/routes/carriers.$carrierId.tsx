import { Component, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { useParams, Link } from 'react-router';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';
import { useCarrierDetail, useUpdateCarrierRate } from '~/hooks/use-carrier-detail';
import { useProfile } from '~/hooks/use-profile';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Skeleton } from '~/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '~/components/ui/table';
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { formatDate, formatNaira } from '~/lib/format';

export function meta() {
  return [{ title: 'SureWaka Admin - Carrier Detail' }];
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean; error: Error | null };

class CarrierDetailErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="rounded-lg border p-6 space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="rounded-lg border p-6 space-y-4">
        <Skeleton className="h-6 w-36" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

// ─── Rate Edit Form ───────────────────────────────────────────────────────────

function RateEditForm({
  carrierId,
  currentRateKobo,
  onSuccess,
}: {
  carrierId: string;
  currentRateKobo: number | null;
  onSuccess: () => void;
}) {
  const { updateRate, isSubmitting } = useUpdateCarrierRate();
  const [rateNaira, setRateNaira] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const parsedRate = parseFloat(rateNaira);
    if (isNaN(parsedRate) || parsedRate <= 0) {
      setError('Rate must be a positive number');
      return;
    }

    const rateInKobo = Math.round(parsedRate * 100);

    const result = await updateRate({
      carrierId,
      basePrice: rateInKobo,
      reason: reason.trim() || undefined,
    });

    if (result.success) {
      setSuccess(true);
      setRateNaira('');
      setReason('');
      onSuccess();
      setTimeout(() => setSuccess(false), 3000);
    } else {
      setError(result.error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate Management</CardTitle>
        <CardDescription>
          Current rate:{' '}
          {currentRateKobo != null ? (
            <span className="font-semibold text-foreground">
              {formatNaira(currentRateKobo / 100)}
            </span>
          ) : (
            <span className="text-muted-foreground italic">Not set</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rate-naira">New Rate (₦)</Label>
            <Input
              id="rate-naira"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="e.g. 3500"
              value={rateNaira}
              onChange={(e) => setRateNaira(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? 'rate-error' : undefined}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-reason">Reason for change (optional)</Label>
            <Input
              id="rate-reason"
              type="text"
              placeholder="e.g. Carrier requested rate adjustment"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div
              id="rate-error"
              className="flex items-center gap-2 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <p className="text-sm text-green-600" role="status">
              Rate updated successfully
            </p>
          )}

          <Button type="submit" disabled={isSubmitting || !rateNaira}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Rate
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Rate History Table ───────────────────────────────────────────────────────

function RateHistoryTable({
  history,
}: {
  history: Array<{
    id: string;
    oldBasePriceKobo: number | null;
    newBasePriceKobo: number;
    changedBy: string | null;
    changedByName: string | null;
    reason: string | null;
    createdAt: string;
  }>;
}) {
  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rate History</CardTitle>
          <CardDescription>No rate changes have been recorded yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate History</CardTitle>
        <CardDescription>
          {history.length} change{history.length !== 1 ? 's' : ''} recorded
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Old Rate</TableHead>
              <TableHead>New Rate</TableHead>
              <TableHead>Changed By</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">{formatDate(entry.createdAt)}</TableCell>
                <TableCell>
                  {entry.oldBasePriceKobo != null
                    ? formatNaira(entry.oldBasePriceKobo / 100)
                    : '—'}
                </TableCell>
                <TableCell className="font-medium">
                  {formatNaira(entry.newBasePriceKobo / 100)}
                </TableCell>
                <TableCell>{entry.changedByName || '—'}</TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {entry.reason || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function CarrierDetailPage() {
  const { carrierId } = useParams();
  const { profile, isLoading: profileLoading } = useProfile();
  const { carrier, isLoading, error, refetch } = useCarrierDetail(carrierId ?? '');

  if (profileLoading || isLoading) {
    return <LoadingSkeleton />;
  }

  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  if (error) {
    const isNotFound = error.toLowerCase().includes('not found') || error.includes('404');

    if (isNotFound) {
      return (
        <div className="flex flex-col gap-6">
          <Link
            to="/carriers"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Carriers
          </Link>
          <div className="flex flex-col items-center justify-center rounded-lg border py-16">
            <h2 className="mb-2 text-lg font-semibold">Carrier not found</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The carrier you are looking for does not exist or has been removed.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/carriers">Back to Carriers</Link>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/carriers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Carriers
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Failed to load carrier</h2>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!carrier) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/carriers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Carriers
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Carrier not found</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            The carrier you are looking for does not exist or has been removed.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/carriers">Back to Carriers</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <RoleGate
      roles={['surewaka_admin']}
      userRoles={userRoles}
      fallback={
        <div className="flex flex-col items-center justify-center rounded-lg border py-16">
          <h2 className="mb-2 text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            You do not have permission to view this page.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Back link */}
        <Link
          to="/carriers"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Carriers
        </Link>

        {/* Page header */}
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{carrier.name}</h1>
            <p className="text-sm text-muted-foreground">{carrier.slug}</p>
          </div>
          <div className="flex gap-2 ml-auto">
            <Badge variant={carrier.isActive ? 'outline' : 'destructive'}>
              {carrier.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {carrier.isVerified && <Badge variant="default">Verified</Badge>}
          </div>
        </div>

        {/* Carrier info summary */}
        <Card>
          <CardHeader>
            <CardTitle>Carrier Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium">{carrier.contactEmail}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rating</dt>
                <dd className="font-medium">{carrier.rating ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Deliveries</dt>
                <dd className="font-medium">{carrier.deliveryCount ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Joined</dt>
                <dd className="font-medium">{formatDate(carrier.createdAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Rate Management */}
        <RateEditForm
          carrierId={carrier.id}
          currentRateKobo={carrier.basePrice}
          onSuccess={refetch}
        />

        {/* Rate History */}
        <RateHistoryTable history={carrier.rateHistory} />
      </div>
    </RoleGate>
  );
}

// ─── Route Export ─────────────────────────────────────────────────────────────

export default function CarrierDetailRoute() {
  return (
    <CarrierDetailErrorBoundary>
      <CarrierDetailPage />
    </CarrierDetailErrorBoundary>
  );
}
