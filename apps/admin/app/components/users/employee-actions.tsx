import { useState } from 'react';
import { Loader2, UserX, UserCheck, AlertTriangle } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

type EmployeeActionsProps = {
  employeeId: string;
  isActive: boolean;
  currentUserId: string;
  onDeactivate: () => Promise<void>;
  onReactivate: () => Promise<void>;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function EmployeeActions({
  employeeId,
  isActive,
  currentUserId,
  onDeactivate,
  onReactivate,
}: EmployeeActionsProps) {
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = employeeId === currentUserId;

  // ─── Deactivate ───────────────────────────────────────────────────────

  const handleDeactivateClick = () => {
    setError(null);
    setDeactivateDialogOpen(true);
  };

  const handleConfirmDeactivate = async () => {
    setLoading(true);
    setError(null);

    try {
      await onDeactivate();
      setDeactivateDialogOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to deactivate employee';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Reactivate ──────────────────────────────────────────────────────

  const handleReactivateClick = () => {
    setError(null);
    setReactivateDialogOpen(true);
  };

  const handleConfirmReactivate = async () => {
    setLoading(true);
    setError(null);

    try {
      await onReactivate();
      setReactivateDialogOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reactivate employee';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {isActive ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeactivateClick}
                  disabled={isSelf}
                  aria-disabled={isSelf}
                >
                  <UserX className="mr-1.5 size-4" />
                  Deactivate Account
                </Button>
              </span>
            </TooltipTrigger>
            {isSelf && (
              <TooltipContent>
                <p>You cannot deactivate your own account</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleReactivateClick}
          className="text-green-600 hover:bg-green-50 hover:text-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
        >
          <UserCheck className="mr-1.5 size-4" />
          Reactivate Account
        </Button>
      )}

      {/* Deactivate confirmation dialog */}
      <Dialog
        open={deactivateDialogOpen}
        onOpenChange={(open) => {
          if (!open && !loading) {
            setDeactivateDialogOpen(false);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Deactivate Employee
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to deactivate this employee? This action will:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Set the account status to inactive</li>
              <li>
                <span className="font-medium text-destructive">
                  Revoke all currently assigned roles
                </span>
              </li>
              <li>Remove platform access immediately</li>
            </ul>

            <p className="text-sm text-muted-foreground">
              Roles will need to be manually re-assigned if the account is reactivated later.
            </p>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeactivateDialogOpen(false);
                setError(null);
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeactivate}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {loading ? 'Deactivating...' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate confirmation dialog */}
      <Dialog
        open={reactivateDialogOpen}
        onOpenChange={(open) => {
          if (!open && !loading) {
            setReactivateDialogOpen(false);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="size-5 text-green-600" />
              Reactivate Employee
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to reactivate this employee account?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-medium">Important: Roles must be re-assigned</p>
              <p className="mt-1">
                Reactivating this account will restore access, but all previously held roles were
                revoked during deactivation. You will need to assign roles after reactivation.
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReactivateDialogOpen(false);
                setError(null);
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmReactivate}
              disabled={loading}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {loading && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {loading ? 'Reactivating...' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
