import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { USER_ROLES, inviteEmployeeSchema } from '@surewaka/shared';
import { useAuth } from '@clerk/react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const ORG_SCOPED_ROLES = ['carrier_admin', 'carrier_driver'] as const;

type Carrier = {
  id: string;
  name: string;
};

type InviteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

type FormErrors = {
  email?: string;
  fullName?: string;
  role?: string;
  scopeId?: string;
  general?: string;
};

function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function InviteDialog({ open, onOpenChange, onSuccess }: InviteDialogProps) {
  const { getToken } = useAuth();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [isLoadingCarriers, setIsLoadingCarriers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [successMessage, setSuccessMessage] = useState('');

  const isOrgScoped = ORG_SCOPED_ROLES.includes(role as (typeof ORG_SCOPED_ROLES)[number]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setEmail('');
      setFullName('');
      setRole('');
      setScopeId('');
      setErrors({});
      setSuccessMessage('');
    }
  }, [open]);

  // Fetch carriers when an org-scoped role is selected
  useEffect(() => {
    if (!isOrgScoped) {
      setCarriers([]);
      setScopeId('');
      return;
    }

    let cancelled = false;

    async function fetchCarriers() {
      setIsLoadingCarriers(true);
      try {
        const accessToken = await getToken();

        if (!accessToken) return;

        const response = await fetch(`${API_URL}/api/v1/carriers`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const body = await response.json();
          if (!cancelled) {
            setCarriers(body.data ?? []);
          }
        }
      } catch {
        // Silently fail — carrier list is non-critical for form display
      } finally {
        if (!cancelled) {
          setIsLoadingCarriers(false);
        }
      }
    }

    fetchCarriers();

    return () => {
      cancelled = true;
    };
  }, [isOrgScoped]);

  const validate = useCallback(() => {
    const formData = {
      email: email.trim(),
      fullName: fullName.trim(),
      role,
      scopeType: isOrgScoped ? ('carrier' as const) : null,
      scopeId: isOrgScoped ? scopeId : null,
    };

    const result = inviteEmployeeSchema.safeParse(formData);

    if (!result.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const path = issue.path[0] as string | undefined;
        if (path === 'email') {
          fieldErrors.email = issue.message;
        } else if (path === 'fullName') {
          fieldErrors.fullName = issue.message;
        } else if (path === 'role') {
          fieldErrors.role = issue.message;
        } else if (path === 'scopeId' || path === 'scopeType') {
          fieldErrors.scopeId = 'Please select a carrier';
        } else {
          // Refinement errors (org-scoped roles require scope)
          fieldErrors.scopeId = issue.message;
        }
      }
      setErrors(fieldErrors);
      return null;
    }

    setErrors({});
    return result.data;
  }, [email, fullName, role, scopeId, isOrgScoped]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validatedData = validate();
    if (!validatedData) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const accessToken = await getToken();

      if (!accessToken) {
        setErrors({ general: 'Not authenticated. Please sign in again.' });
        setIsSubmitting(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/v1/admin/users/invite`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validatedData),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error?.message || `Invitation failed (${response.status})`;
        setErrors({ general: message });
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage(`Invitation sent to ${validatedData.email}`);

      // Close dialog after brief success feedback
      setTimeout(() => {
        onOpenChange(false);
        onSuccess();
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setErrors({ general: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Employee</DialogTitle>
          <DialogDescription>
            Send an invitation email to add a new team member.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Success message */}
          {successMessage && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
              {successMessage}
            </div>
          )}

          {/* General error */}
          {errors.general && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {errors.general}
            </div>
          )}

          {/* Email field */}
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="employee@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              disabled={isSubmitting}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          {/* Full Name field */}
          <div className="space-y-2">
            <Label htmlFor="invite-fullname">Full Name</Label>
            <Input
              id="invite-fullname"
              type="text"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={!!errors.fullName}
              disabled={isSubmitting}
            />
            {errors.fullName && (
              <p className="text-xs text-destructive">{errors.fullName}</p>
            )}
          </div>

          {/* Role dropdown */}
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={isSubmitting}>
              <SelectTrigger id="invite-role" aria-invalid={!!errors.role}>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {formatRoleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && (
              <p className="text-xs text-destructive">{errors.role}</p>
            )}
          </div>

          {/* Carrier dropdown (conditional) */}
          {isOrgScoped && (
            <div className="space-y-2">
              <Label htmlFor="invite-carrier">Carrier</Label>
              {isLoadingCarriers ? (
                <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading carriers...
                </div>
              ) : (
                <Select value={scopeId} onValueChange={setScopeId} disabled={isSubmitting}>
                  <SelectTrigger id="invite-carrier" aria-invalid={!!errors.scopeId}>
                    <SelectValue placeholder="Select a carrier" />
                  </SelectTrigger>
                  <SelectContent>
                    {carriers.map((carrier) => (
                      <SelectItem key={carrier.id} value={carrier.id}>
                        {carrier.name}
                      </SelectItem>
                    ))}
                    {carriers.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        No carriers available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              {errors.scopeId && (
                <p className="text-xs text-destructive">{errors.scopeId}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !!successMessage}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
