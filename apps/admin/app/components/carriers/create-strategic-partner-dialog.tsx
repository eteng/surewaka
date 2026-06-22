import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createStrategicCarrierSchema } from '@surewaka/shared';
import { useAuth } from '@clerk/react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type CreateStrategicPartnerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function CreateStrategicPartnerDialog({ open, onOpenChange, onSuccess }: CreateStrategicPartnerDialogProps) {
  const { getToken } = useAuth();
  const [carrierName, setCarrierName] = useState('');
  const [slug, setSlug] = useState('');
  const [contactName, setContactName] = useState('');
  const [inviteMethod, setInviteMethod] = useState<'email' | 'phone'>('email');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [driverVettingEnabled, setDriverVettingEnabled] = useState(false);
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
      contactName,
      adminEmail: inviteMethod === 'email' ? adminEmail : undefined,
      adminPhone: inviteMethod === 'phone' ? adminPhone : undefined,
      driverVettingEnabled,
    };

    const parsed = createStrategicCarrierSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    setLoading(true);
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/v1/admin/carriers/strategic`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(json.error?.message ?? 'Failed to create carrier');
      return;
    }

    onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Strategic Partner</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="sp-name">Carrier Name</Label>
            <Input id="sp-name" value={carrierName} onChange={(e) => handleNameChange(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sp-slug">Slug</Label>
            <Input id="sp-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sp-contact">Contact Name</Label>
            <Input id="sp-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <Label>Invite admin via</Label>
            <Select value={inviteMethod} onValueChange={(v) => setInviteMethod(v as 'email' | 'phone')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone (SMS)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {inviteMethod === 'email' ? (
            <div>
              <Label htmlFor="sp-email">Admin Email</Label>
              <Input id="sp-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="sp-phone">Admin Phone (+234...)</Label>
              <Input id="sp-phone" type="tel" placeholder="+2348012345678" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Driver Vetting</Label>
            <Select value={driverVettingEnabled ? 'yes' : 'no'} onValueChange={(v) => setDriverVettingEnabled(v === 'yes')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — carrier manages independently</SelectItem>
                <SelectItem value="yes">Yes — SureWaka vets each driver</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create & Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
