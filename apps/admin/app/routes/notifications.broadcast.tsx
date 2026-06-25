import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertCircle, Loader2, Megaphone, Send, Users } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

export function meta() {
  return [{ title: 'SureWaka Admin - Push Broadcast' }];
}

type BroadcastSegment = 'all' | 'customers' | 'drivers';

const SEGMENT_OPTIONS: { value: BroadcastSegment; label: string }[] = [
  { value: 'all', label: 'All Users' },
  { value: 'customers', label: 'Customers' },
  { value: 'drivers', label: 'Drivers' },
];

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 500;
const MAX_DEEP_LINK_LENGTH = 2048;

export default function BroadcastRoute() {
  const { getToken } = useAuth();

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState<BroadcastSegment>('all');
  const [deepLink, setDeepLink] = useState('');

  // Estimate state
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // Confirmation modal state
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Dispatch state
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const isFormValid = title.trim().length > 0 && body.trim().length > 0;

  const handleGetEstimate = useCallback(async () => {
    setEstimateLoading(true);
    setEstimateError(null);

    try {
      const accessToken = await getToken();
      if (!accessToken) {
        setEstimateError('Not authenticated');
        return;
      }

      const response = await fetch(
        `${API_URL}/api/v1/admin/broadcast/estimate?segment=${segment}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setEstimateError(
          errorBody?.error?.message || `Request failed with status ${response.status}`,
        );
        return;
      }

      const result = await response.json();
      setEstimate(result.data?.estimate ?? 0);
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : 'Failed to get estimate');
    } finally {
      setEstimateLoading(false);
    }
  }, [getToken, segment]);

  const handleShowConfirmation = () => {
    setShowConfirmation(true);
  };

  const handleDispatch = useCallback(async () => {
    setDispatching(true);
    setDispatchResult(null);

    try {
      const accessToken = await getToken();
      if (!accessToken) {
        setDispatchResult({ success: false, message: 'Not authenticated' });
        return;
      }

      const payload: Record<string, unknown> = {
        title: title.trim(),
        body: body.trim(),
        segment,
      };

      if (deepLink.trim()) {
        payload.deepLink = deepLink.trim();
      }

      const response = await fetch(`${API_URL}/api/v1/admin/broadcast`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setDispatchResult({
          success: false,
          message: result?.error?.message || `Request failed with status ${response.status}`,
        });
        return;
      }

      const enqueued = result?.data?.enqueued ?? 0;
      const failed = result?.data?.failed ?? 0;

      setDispatchResult({
        success: true,
        message: `Broadcast dispatched. ${enqueued} batch(es) enqueued${failed > 0 ? `, ${failed} failed` : ''}.`,
      });

      // Reset form on success
      setTitle('');
      setBody('');
      setDeepLink('');
      setEstimate(null);
    } catch (err) {
      setDispatchResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to dispatch broadcast',
      });
    } finally {
      setDispatching(false);
      setShowConfirmation(false);
    }
  }, [getToken, title, body, segment, deepLink]);

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Push Broadcast</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Send push notifications to user segments. Recipients must have push notifications enabled.
        </p>
      </div>

      {/* Dispatch result */}
      {dispatchResult && (
        <div
          className={`flex items-start gap-3 rounded-lg border p-4 ${
            dispatchResult.success
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
              : 'border-destructive/50 bg-destructive/10 text-destructive'
          }`}
        >
          {dispatchResult.success ? (
            <Send className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="text-sm">{dispatchResult.message}</p>
        </div>
      )}

      {/* Form */}
      <div className="max-w-2xl space-y-6 rounded-lg border p-6">
        {/* Title */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="broadcast-title">Title</Label>
            <span
              className={`text-xs ${
                title.length > MAX_TITLE_LENGTH ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {title.length}/{MAX_TITLE_LENGTH}
            </span>
          </div>
          <Input
            id="broadcast-title"
            placeholder="Notification title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
            maxLength={MAX_TITLE_LENGTH}
            aria-invalid={title.length > MAX_TITLE_LENGTH}
          />
        </div>

        {/* Body */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="broadcast-body">Body</Label>
            <span
              className={`text-xs ${
                body.length > MAX_BODY_LENGTH ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {body.length}/{MAX_BODY_LENGTH}
            </span>
          </div>
          <textarea
            id="broadcast-body"
            placeholder="Notification body message"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
            maxLength={MAX_BODY_LENGTH}
            rows={4}
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40"
            aria-invalid={body.length > MAX_BODY_LENGTH}
          />
        </div>

        {/* Segment */}
        <div className="space-y-3">
          <Label>Target Segment</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            {SEGMENT_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                  segment === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-accent/50'
                }`}
              >
                <input
                  type="radio"
                  name="segment"
                  value={option.value}
                  checked={segment === option.value}
                  onChange={(e) => {
                    setSegment(e.target.value as BroadcastSegment);
                    setEstimate(null);
                  }}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Deep Link URL (optional) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="broadcast-deep-link">
              Deep Link URL <span className="text-muted-foreground">(optional)</span>
            </Label>
            <span
              className={`text-xs ${
                deepLink.length > MAX_DEEP_LINK_LENGTH
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }`}
            >
              {deepLink.length > 0 ? `${deepLink.length}/${MAX_DEEP_LINK_LENGTH}` : ''}
            </span>
          </div>
          <Input
            id="broadcast-deep-link"
            type="url"
            placeholder="https://example.com/promo"
            value={deepLink}
            onChange={(e) => setDeepLink(e.target.value.slice(0, MAX_DEEP_LINK_LENGTH))}
            maxLength={MAX_DEEP_LINK_LENGTH}
            aria-invalid={deepLink.length > MAX_DEEP_LINK_LENGTH}
          />
          <p className="text-xs text-muted-foreground">
            Opens in-app when the user taps the notification. Leave empty to open the home screen.
          </p>
        </div>

        {/* Estimate section */}
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
          <Users className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            {estimate !== null ? (
              <p className="text-sm font-medium">
                ~{estimate.toLocaleString()} estimated recipient{estimate !== 1 ? 's' : ''}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Get an estimate of how many users will receive this notification
              </p>
            )}
            {estimateError && (
              <p className="mt-1 text-xs text-destructive">{estimateError}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGetEstimate}
            disabled={estimateLoading}
          >
            {estimateLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Get Estimate'
            )}
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t pt-4">
          <Button
            onClick={handleShowConfirmation}
            disabled={!isFormValid || dispatching}
          >
            {dispatching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Broadcast
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Broadcast</DialogTitle>
            <DialogDescription>
              You are about to send a push notification to{' '}
              {estimate !== null ? (
                <strong>~{estimate.toLocaleString()} user{estimate !== 1 ? 's' : ''}</strong>
              ) : (
                <strong>
                  {segment === 'all' ? 'all users' : segment}
                </strong>
              )}
              . This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Title</p>
              <p className="text-sm">{title}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Body</p>
              <p className="text-sm">{body}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Segment</p>
              <p className="text-sm capitalize">
                {SEGMENT_OPTIONS.find((o) => o.value === segment)?.label ?? segment}
              </p>
            </div>
            {deepLink && (
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Deep Link</p>
                <p className="text-sm break-all">{deepLink}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmation(false)}
              disabled={dispatching}
            >
              Cancel
            </Button>
            <Button onClick={handleDispatch} disabled={dispatching}>
              {dispatching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Confirm & Send'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">We've been notified and are looking into it.</p>
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </div>
  );
}
