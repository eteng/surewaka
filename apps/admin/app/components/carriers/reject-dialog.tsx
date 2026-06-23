import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { RejectCarrierApplicationInput } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';

type RejectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (input: RejectCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
};

export function RejectDialog({ open, onOpenChange, onReject }: RejectDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (reason.trim().length < 10) {
      setError('Provide at least 10 characters explaining the rejection');
      return;
    }

    setLoading(true);
    const result = await onReject({ reason: reason.trim() });
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? 'Rejection failed');
      return;
    }

    setReason('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Application</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This will close the application. The applicant will not be notified automatically.
          </p>
          <div>
            <Label htmlFor="reason">Reason (internal)</Label>
            <textarea
              id="reason"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[100px]"
              placeholder="CAC number could not be verified after three attempts..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
