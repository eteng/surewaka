import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { approveCarrierApplicationSchema } from '@surewaka/shared';
import type { ApproveCarrierApplicationInput } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';

type ApproveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillName?: string;
  prefillEmail?: string;
  prefillPhone?: string;
  onApprove: (input: ApproveCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
};

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function ApproveDialog({
  open,
  onOpenChange,
  prefillName = '',
  prefillEmail = '',
  prefillPhone = '',
  onApprove,
}: ApproveDialogProps) {
  const [carrierName, setCarrierName] = useState(prefillName);
  const [slug, setSlug] = useState(toSlug(prefillName));
  const [driverVettingEnabled, setDriverVettingEnabled] = useState(false);
  const [inviteMethod, setInviteMethod] = useState<'email' | 'phone'>(prefillEmail ? 'email' : 'phone');
  const [adminEmail, setAdminEmail] = useState(prefillEmail);
  const [adminPhone, setAdminPhone] = useState(prefillPhone);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNameChange = (v: string) => {
    setCarrierName(v);
    setSlug(toSlug(v));
  };

  const handleSubmit = async () => {
    setError('');
    const input = {
      carrierName,
      slug,
      driverVettingEnabled,
      adminEmail: inviteMethod === 'email' ? adminEmail : undefined,
      adminPhone: inviteMethod === 'phone' ? adminPhone : undefined,
      notes: notes || undefined,
    };

    const parsed = approveCarrierApplicationSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    setLoading(true);
    const result = await onApprove(parsed.data);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? 'Approval failed');
      return;
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve Carrier Application</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="carrier-name">Carrier Name</Label>
            <Input id="carrier-name" value={carrierName} onChange={(e) => handleNameChange(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>

          <div>
            <Label>Driver Vetting</Label>
            <Select
              value={driverVettingEnabled ? 'yes' : 'no'}
              onValueChange={(v) => setDriverVettingEnabled(v === 'yes')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — carrier manages drivers independently</SelectItem>
                <SelectItem value="yes">Yes — SureWaka vets each new driver</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Invite carrier admin via</Label>
            <Select value={inviteMethod} onValueChange={(v) => setInviteMethod(v as 'email' | 'phone')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone (SMS)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {inviteMethod === 'email' ? (
            <div>
              <Label htmlFor="admin-email">Admin Email</Label>
              <Input id="admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="admin-phone">Admin Phone (+234...)</Label>
              <Input id="admin-phone" type="tel" placeholder="+2348012345678" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />
            </div>
          )}

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve & Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
