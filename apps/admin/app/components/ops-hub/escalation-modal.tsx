import { useState } from 'react';
import { Phone, RefreshCw, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { useAuth } from '@clerk/react';
import type { EscalationAction } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type EscalationModalProps = {
  deliveryId: string;
  onClose: () => void;
};

export function EscalationModal({ deliveryId, onClose }: EscalationModalProps) {
  const { getToken } = useAuth();
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escalate = async (action: EscalationAction) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/ops-hub/escalate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deliveryId, action, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Escalation failed');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escalation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escalate Delivery</DialogTitle>
          <DialogDescription>
            Choose an action for delivery{' '}
            <span className="font-mono font-medium">{deliveryId.slice(0, 8).toUpperCase()}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="escalation-note">Note (optional)</Label>
            <textarea
              id="escalation-note"
              placeholder="Add context for this escalation…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => void escalate('call_driver')}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
            aria-label="Call driver"
          >
            <Phone className="mr-2 h-4 w-4" aria-hidden="true" />
            Call Driver
          </Button>
          <Button
            variant="outline"
            onClick={() => void escalate('reassign')}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
            aria-label="Reassign delivery"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reassign
          </Button>
          <Button
            variant="destructive"
            onClick={() => void escalate('mark_failed')}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
            aria-label="Mark delivery as failed"
          >
            <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Mark Failed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
