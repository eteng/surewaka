import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Loader2, ShieldAlert, Users, X } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import { useProfile } from '~/hooks/use-profile';
import { supabase } from '~/lib/supabase';

export function meta() {
  return [{ title: 'SureWaka Admin - Name Change Requests' }];
}

type NameChangeRequest = {
  id: string;
  userId: string;
  userName: string;
  currentName: string;
  requestedName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

function NameChangesSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 p-8">
      <ShieldAlert className="h-10 w-10 text-destructive" />
      <div className="text-center">
        <h3 className="text-sm font-medium text-foreground">Access Denied</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          You do not have permission to view this page. Only administrators can manage name change
          requests.
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-8">
      <Clock className="h-10 w-10 text-muted-foreground" />
      <div className="text-center">
        <h3 className="text-sm font-medium text-foreground">No pending requests</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          There are no name change requests awaiting review.
        </p>
      </div>
    </div>
  );
}

function RequestCard({
  request,
  onApprove,
  onReject,
  isProcessing,
}: {
  request: NameChangeRequest;
  onApprove: (id: string, reviewNote: string) => void;
  onReject: (id: string, reviewNote: string) => void;
  isProcessing: boolean;
}) {
  const [reviewNote, setReviewNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);

  const formattedDate = new Date(request.createdAt).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{request.currentName}</span>
            <span className="text-muted-foreground">→</span>
            <span className="text-sm font-medium text-foreground">{request.requestedName}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Reason:</span> {request.reason}
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Submitted {formattedDate}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => onApprove(request.id, reviewNote)}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onReject(request.id, reviewNote)}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Reject
            </Button>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowNoteInput(!showNoteInput)}
          >
            {showNoteInput ? 'Hide note' : 'Add review note'}
          </button>
        </div>
      </div>

      {showNoteInput && (
        <div className="mt-3 border-t border-border pt-3">
          <Input
            placeholder="Optional review note..."
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            className="text-sm"
          />
        </div>
      )}
    </div>
  );
}

export default function SettingsNameChanges() {
  const { profile, isLoading: isProfileLoading } = useProfile();
  const [requests, setRequests] = useState<NameChangeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const isAdmin = profile?.role === 'surewaka_admin';

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/admin/name-change-requests`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || `Request failed with status ${response.status}`;
        setError(message);
        setRequests([]);
        setIsLoading(false);
        return;
      }

      const body = await response.json();
      setRequests(body.data ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchRequests();
    } else if (!isProfileLoading) {
      setIsLoading(false);
    }
  }, [isAdmin, isProfileLoading, fetchRequests]);

  const handleReview = useCallback(
    async (requestId: string, status: 'approved' | 'rejected', reviewNote: string) => {
      setProcessingId(requestId);
      setError(null);

      try {
        const accessToken = await getAccessToken();

        if (!accessToken) {
          setError('Not authenticated');
          return;
        }

        const body: { status: string; reviewNote?: string } = { status };
        if (reviewNote.trim()) {
          body.reviewNote = reviewNote.trim();
        }

        const response = await fetch(`${API_URL}/api/v1/admin/name-change-requests/${requestId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const responseBody = await response.json().catch(() => null);
          const message =
            responseBody?.error?.message || `Failed to ${status === 'approved' ? 'approve' : 'reject'} request`;
          setError(message);
          return;
        }

        // Refresh the list after successful action
        await fetchRequests();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
      } finally {
        setProcessingId(null);
      }
    },
    [fetchRequests]
  );

  const handleApprove = useCallback(
    (id: string, reviewNote: string) => {
      handleReview(id, 'approved', reviewNote);
    },
    [handleReview]
  );

  const handleReject = useCallback(
    (id: string, reviewNote: string) => {
      handleReview(id, 'rejected', reviewNote);
    },
    [handleReview]
  );

  // Show loading while profile is being fetched
  if (isProfileLoading) {
    return (
      <div className="pt-4">
        <h1 className="text-2xl font-bold text-foreground">Name Change Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and manage pending name change requests
        </p>
        <div className="mt-6">
          <NameChangesSkeleton />
        </div>
      </div>
    );
  }

  // Access denied for non-admins
  if (!isAdmin) {
    return (
      <div className="pt-4">
        <h1 className="text-2xl font-bold text-foreground">Name Change Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and manage pending name change requests
        </p>
        <div className="mt-6">
          <AccessDenied />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Name Change Requests</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Review and manage pending name change requests
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="mt-6">
        {isLoading ? (
          <NameChangesSkeleton />
        ) : requests.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                onApprove={handleApprove}
                onReject={handleReject}
                isProcessing={processingId === request.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
