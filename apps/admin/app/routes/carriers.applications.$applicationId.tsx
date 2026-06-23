import { useParams, useNavigate } from 'react-router';
import { useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { useCarrierApplicationDetail } from '~/hooks/use-carrier-application-detail';
import { ApproveDialog } from '~/components/carriers/approve-dialog';
import { RejectDialog } from '~/components/carriers/reject-dialog';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';

export function meta() {
  return [{ title: 'SureWaka Admin - Carrier Application' }];
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  under_review: { label: 'Under Review', variant: 'default' },
  approved: { label: 'Approved', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

export default function ApplicationDetail() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { application, isLoading, error, refetch, startReview, approve, reject } =
    useCarrierApplicationDetail(applicationId!);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error ?? 'Application not found'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/carriers/applications')}>
          Back to Applications
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_LABELS[application.status] ?? { label: application.status, variant: 'secondary' as const };

  const handleStartReview = async () => {
    const result = await startReview();
    if (result.ok) refetch();
  };

  return (
    <div className="p-8 max-w-3xl">
      <button
        onClick={() => navigate('/carriers/applications')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Applications
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{application.businessName}</h1>
          <p className="text-muted-foreground mt-1">{application.contactName} · {application.email} · {application.phone}</p>
        </div>
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">CAC Number</p>
          <p className="mt-1">{application.cacNumber ?? '—'}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Fleet Size</p>
          <p className="mt-1">{application.fleetSize ?? '—'}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Service Areas</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {application.serviceAreas.map((a) => (
              <span key={a} className="text-xs bg-muted px-2 py-0.5 rounded">{a}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Submitted</p>
          <p className="mt-1">{new Date(application.createdAt).toLocaleDateString('en-NG')}</p>
        </div>
        {application.notes && (
          <div className="col-span-2">
            <p className="text-sm font-medium text-muted-foreground">Applicant Notes</p>
            <p className="mt-1 text-sm">{application.notes}</p>
          </div>
        )}
      </div>

      {application.status === 'pending' && (
        <div className="flex gap-3 mb-8">
          <Button onClick={handleStartReview}>Start Review</Button>
        </div>
      )}
      {application.status === 'under_review' && (
        <div className="flex gap-3 mb-8">
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => setApproveOpen(true)}
          >
            Approve
          </Button>
          <Button variant="destructive" onClick={() => setRejectOpen(true)}>Reject</Button>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4">Audit Trail</h2>
        <div className="space-y-3">
          {application.events.map((event) => (
            <div key={event.id} className="flex items-start gap-3">
              <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm">
                  {event.fromStatus ? (
                    <span>
                      <Badge variant="outline" className="text-xs">{event.fromStatus}</Badge>
                      {' → '}
                      <Badge variant="outline" className="text-xs">{event.toStatus}</Badge>
                    </span>
                  ) : (
                    <span>Application submitted</span>
                  )}
                  {event.performedBy && <span className="text-muted-foreground"> by {event.performedBy.name}</span>}
                </p>
                {event.notes && <p className="text-xs text-muted-foreground mt-0.5">{event.notes}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(event.createdAt).toLocaleString('en-NG')}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ApproveDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        prefillName={application.businessName}
        prefillEmail={application.email}
        prefillPhone={application.phone}
        onApprove={async (input) => {
          const result = await approve(input);
          if (result.ok) { refetch(); setApproveOpen(false); }
          return result;
        }}
      />

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onReject={async (input) => {
          const result = await reject(input);
          if (result.ok) { refetch(); setRejectOpen(false); }
          return result;
        }}
      />
    </div>
  );
}
