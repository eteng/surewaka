import { useCallback, useState } from 'react';
import { Loader2, ShieldCheck, ShieldX, Plus, X } from 'lucide-react';
import { USER_ROLES } from '@surewaka/shared';
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
import { cn } from '~/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveRole = {
  role: string;
  scopeType: string | null;
  scopeId: string | null;
};

type Carrier = {
  id: string;
  name: string;
  role: string;
};

type AssignRoleData = {
  userId: string;
  role: string;
  scopeType?: string | null;
  scopeId?: string | null;
};

type RevokeRoleData = {
  userId: string;
  role: string;
  scopeType?: string | null;
  scopeId?: string | null;
  reason?: string;
};

type RoleAssignmentPanelProps = {
  userId: string;
  activeRoles: ActiveRole[];
  carriers: Carrier[];
  onAssignRole: (data: AssignRoleData) => Promise<void>;
  onRevokeRole: (data: RevokeRoleData) => Promise<void>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_SCOPED_ROLES = ['carrier_admin', 'carrier_driver'] as const;

const ROLE_DESCRIPTIONS: Record<string, string> = {
  customer: 'End user who books deliveries and tracks packages',
  driver: 'Independent driver who accepts and fulfills delivery jobs',
  carrier_driver: 'Driver employed by a specific carrier organization',
  carrier_admin: 'Fleet manager who oversees a carrier organization',
  support_agent: 'Customer support staff who resolves issues and disputes',
  surewaka_admin: 'Platform administrator with full system access',
};

const roleBadgeStyles: Record<string, string> = {
  surewaka_admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  carrier_admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  carrier_driver: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  support_agent: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  customer: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  driver: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRoleBadgeStyle(role: string): string {
  return roleBadgeStyles[role] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

function isOrgScoped(role: string): boolean {
  return ORG_SCOPED_ROLES.includes(role as (typeof ORG_SCOPED_ROLES)[number]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoleAssignmentPanel({
  userId,
  activeRoles,
  carriers,
  onAssignRole,
  onRevokeRole,
}: RoleAssignmentPanelProps) {
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [selectedCarrierId, setSelectedCarrierId] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  const [revokeDialogRole, setRevokeDialogRole] = useState<ActiveRole | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeSuccess, setRevokeSuccess] = useState<string | null>(null);

  const isRoleActive = useCallback(
    (role: string) => activeRoles.some((ar) => ar.role === role),
    [activeRoles],
  );

  const getActiveRoleEntry = useCallback(
    (role: string) => activeRoles.find((ar) => ar.role === role) ?? null,
    [activeRoles],
  );

  // ─── Assign Role ─────────────────────────────────────────────────────

  const handleAssignClick = (role: string) => {
    setAssigningRole(role);
    setSelectedCarrierId('');
    setAssignError(null);
    setAssignSuccess(null);
  };

  const handleCancelAssign = () => {
    setAssigningRole(null);
    setSelectedCarrierId('');
    setAssignError(null);
  };

  const handleConfirmAssign = async () => {
    if (!assigningRole) return;

    const needsCarrier = isOrgScoped(assigningRole);
    if (needsCarrier && !selectedCarrierId) {
      setAssignError('Please select a carrier');
      return;
    }

    setAssignLoading(true);
    setAssignError(null);

    try {
      await onAssignRole({
        userId,
        role: assigningRole,
        scopeType: needsCarrier ? 'carrier' : null,
        scopeId: needsCarrier ? selectedCarrierId : null,
      });

      setAssignSuccess(`${formatRoleLabel(assigningRole)} assigned successfully`);
      setAssigningRole(null);
      setSelectedCarrierId('');

      setTimeout(() => setAssignSuccess(null), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to assign role';
      setAssignError(message);
    } finally {
      setAssignLoading(false);
    }
  };

  // ─── Revoke Role ────────────────────────────────────────────────────

  const handleRevokeClick = (role: ActiveRole) => {
    setRevokeDialogRole(role);
    setRevokeReason('');
    setRevokeError(null);
    setRevokeSuccess(null);
  };

  const handleCancelRevoke = () => {
    setRevokeDialogRole(null);
    setRevokeReason('');
    setRevokeError(null);
  };

  const handleConfirmRevoke = async () => {
    if (!revokeDialogRole) return;

    setRevokeLoading(true);
    setRevokeError(null);

    try {
      await onRevokeRole({
        userId,
        role: revokeDialogRole.role,
        scopeType: revokeDialogRole.scopeType,
        scopeId: revokeDialogRole.scopeId,
        reason: revokeReason.trim() || undefined,
      });

      setRevokeSuccess(`${formatRoleLabel(revokeDialogRole.role)} revoked successfully`);
      setRevokeDialogRole(null);
      setRevokeReason('');

      setTimeout(() => setRevokeSuccess(null), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke role';
      setRevokeError(message);
    } finally {
      setRevokeLoading(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Roles</h3>
      </div>

      {/* Success feedback */}
      {(assignSuccess || revokeSuccess) && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          {assignSuccess || revokeSuccess}
        </div>
      )}

      {/* Role list */}
      <div className="space-y-3">
        {USER_ROLES.map((role) => {
          const active = isRoleActive(role);
          const activeEntry = getActiveRoleEntry(role);
          const isCurrentlyAssigning = assigningRole === role;
          const carrierName = active && activeEntry?.scopeId
            ? carriers.find((c) => c.id === activeEntry.scopeId)?.name
            : null;

          return (
            <div
              key={role}
              className={cn(
                'rounded-lg border p-4 transition-colors',
                active && 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        getRoleBadgeStyle(role),
                      )}
                    >
                      {formatRoleLabel(role)}
                    </span>
                    {active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                        <ShieldCheck className="size-3" />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {ROLE_DESCRIPTIONS[role] ?? 'No description available'}
                  </p>
                  {active && carrierName && (
                    <p className="text-xs text-muted-foreground">
                      Carrier: <span className="font-medium">{carrierName}</span>
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {active ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                      onClick={() => handleRevokeClick(activeEntry!)}
                    >
                      <ShieldX className="mr-1 size-3.5" />
                      Revoke
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAssignClick(role)}
                      disabled={isCurrentlyAssigning}
                    >
                      <Plus className="mr-1 size-3.5" />
                      Assign
                    </Button>
                  )}
                </div>
              </div>

              {/* Inline carrier selection for org-scoped role assignment */}
              {isCurrentlyAssigning && isOrgScoped(role) && (
                <div className="mt-3 flex items-end gap-2 border-t pt-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor={`carrier-select-${role}`} className="text-xs">
                      Select Carrier
                    </Label>
                    <Select
                      value={selectedCarrierId}
                      onValueChange={setSelectedCarrierId}
                      disabled={assignLoading}
                    >
                      <SelectTrigger id={`carrier-select-${role}`}>
                        <SelectValue placeholder="Choose a carrier..." />
                      </SelectTrigger>
                      <SelectContent>
                        {carriers.length === 0 ? (
                          <SelectItem value="__none__" disabled>
                            No carriers available
                          </SelectItem>
                        ) : (
                          carriers.map((carrier) => (
                            <SelectItem key={carrier.id} value={carrier.id}>
                              {carrier.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {assignError && (
                      <p className="text-xs text-destructive">{assignError}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleConfirmAssign}
                    disabled={assignLoading || !selectedCarrierId}
                  >
                    {assignLoading && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelAssign}
                    disabled={assignLoading}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}

              {/* Inline confirm for non-org-scoped role assignment */}
              {isCurrentlyAssigning && !isOrgScoped(role) && (
                <div className="mt-3 flex items-center gap-2 border-t pt-3">
                  <p className="flex-1 text-sm text-muted-foreground">
                    Assign <span className="font-medium">{formatRoleLabel(role)}</span> to this
                    employee?
                  </p>
                  {assignError && (
                    <p className="text-xs text-destructive">{assignError}</p>
                  )}
                  <Button
                    size="sm"
                    onClick={handleConfirmAssign}
                    disabled={assignLoading}
                  >
                    {assignLoading && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelAssign}
                    disabled={assignLoading}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Revoke confirmation dialog */}
      <Dialog
        open={revokeDialogRole !== null}
        onOpenChange={(open) => {
          if (!open) handleCancelRevoke();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Role</DialogTitle>
            <DialogDescription>
              Remove the{' '}
              <span className="font-medium">
                {revokeDialogRole ? formatRoleLabel(revokeDialogRole.role) : ''}
              </span>{' '}
              role from this employee. This action will be logged in the audit trail.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="revoke-reason">Reason (optional)</Label>
              <Input
                id="revoke-reason"
                placeholder="e.g., Role no longer needed, transferred to another team"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                disabled={revokeLoading}
              />
            </div>

            {revokeError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {revokeError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelRevoke}
              disabled={revokeLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRevoke}
              disabled={revokeLoading}
            >
              {revokeLoading && <Loader2 className="mr-1 size-4 animate-spin" />}
              {revokeLoading ? 'Revoking...' : 'Revoke Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
