import { useState } from 'react';
import { Clock, FileEdit, Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

type PendingNameChange = {
  id: string;
  requestedName: string;
  reason: string;
  status: 'pending';
  createdAt: string;
};

type NameChangeFormProps = {
  pendingNameChange: PendingNameChange | null;
  onSubmit: (data: { requestedName: string; reason: string }) => Promise<void>;
  isUpdating: boolean;
};

type ValidationErrors = {
  requestedName?: string;
  reason?: string;
};

function validate(requestedName: string, reason: string): ValidationErrors {
  const errors: ValidationErrors = {};

  if (requestedName.trim().length === 0) {
    errors.requestedName = 'Name cannot be only whitespace';
  } else if (requestedName.length < 2) {
    errors.requestedName = 'Name must be at least 2 characters';
  } else if (requestedName.length > 100) {
    errors.requestedName = 'Name must be at most 100 characters';
  }

  if (reason.length < 3) {
    errors.reason = 'Reason must be at least 3 characters';
  } else if (reason.length > 500) {
    errors.reason = 'Reason must be at most 500 characters';
  }

  return errors;
}

export function NameChangeForm({ pendingNameChange, onSubmit, isUpdating }: NameChangeFormProps) {
  const [requestedName, setRequestedName] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<{ requestedName: boolean; reason: boolean }>({
    requestedName: false,
    reason: false,
  });

  const hasPending = pendingNameChange !== null;

  function handleBlur(field: 'requestedName' | 'reason') {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const validationErrors = validate(requestedName, reason);
    setErrors(validationErrors);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationErrors = validate(requestedName, reason);
    setErrors(validationErrors);
    setTouched({ requestedName: true, reason: true });

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    await onSubmit({ requestedName, reason });
    setRequestedName('');
    setReason('');
    setTouched({ requestedName: false, reason: false });
    setErrors({});
  }

  const currentErrors = validate(requestedName, reason);
  const isFormInvalid = Object.keys(currentErrors).length > 0;
  const isDisabled = hasPending || isUpdating;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <FileEdit className="h-4 w-4" />
          Name Change Request
        </h3>
        <p className="text-sm text-muted-foreground">
          Submit a request to change your display name. An admin will review it.
        </p>
      </div>

      {hasPending && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Pending request
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                <span className="font-medium">Requested name:</span>{' '}
                {pendingNameChange.requestedName}
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                <span className="font-medium">Reason:</span> {pendingNameChange.reason}
              </p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                Submitted on{' '}
                {new Date(pendingNameChange.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="requestedName" className="text-sm font-medium text-foreground">
            Requested Name
          </label>
          <Input
            id="requestedName"
            type="text"
            placeholder="Enter your new name"
            value={requestedName}
            onChange={(e) => setRequestedName(e.target.value)}
            onBlur={() => handleBlur('requestedName')}
            disabled={isDisabled}
            aria-invalid={touched.requestedName && !!errors.requestedName}
            aria-describedby={
              touched.requestedName && errors.requestedName
                ? 'requestedName-error'
                : undefined
            }
          />
          {touched.requestedName && errors.requestedName && (
            <p id="requestedName-error" className="text-sm text-destructive">
              {errors.requestedName}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="reason" className="text-sm font-medium text-foreground">
            Reason
          </label>
          <textarea
            id="reason"
            placeholder="Why are you requesting this change?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => handleBlur('reason')}
            disabled={isDisabled}
            rows={3}
            aria-invalid={touched.reason && !!errors.reason}
            aria-describedby={touched.reason && errors.reason ? 'reason-error' : undefined}
            className="h-auto w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 resize-none"
          />
          {touched.reason && errors.reason && (
            <p id="reason-error" className="text-sm text-destructive">
              {errors.reason}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isFormInvalid || isDisabled} size="sm">
          {isUpdating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit Request'
          )}
        </Button>
      </form>
    </div>
  );
}
