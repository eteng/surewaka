import { Form, useActionData, useNavigation } from 'react-router';
import { cn } from '~/lib/utils';

type ActionData = {
  success: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

type WaitlistFormProps = {
  source?: string;
};

export function WaitlistForm({ source = 'home' }: WaitlistFormProps) {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  if (actionData?.success) {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-6 text-center">
        <h3 className="text-lg font-semibold text-foreground">You&apos;re on the list! 🎉</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {actionData.message || "We'll notify you when SureWaka launches. Stay tuned!"}
        </p>
      </div>
    );
  }

  return (
    <Form method="post" className="flex flex-col gap-4">
      <input type="hidden" name="source" value={source} />

      {/* Honeypot — hidden from real users, bots will fill it */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          type="text"
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {/* Full Name */}
      <div>
        <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-foreground">
          Full Name
        </label>
        <input
          type="text"
          id="fullName"
          name="fullName"
          required
          placeholder="Your full name"
          className={cn(
            'w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
            actionData?.errors?.fullName && 'border-destructive focus:border-destructive focus:ring-destructive',
          )}
        />
        {actionData?.errors?.fullName && (
          <p className="mt-1 text-xs text-destructive">{actionData.errors.fullName[0]}</p>
        )}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-foreground">
          Email Address
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          placeholder="you@example.com"
          className={cn(
            'w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
            actionData?.errors?.email && 'border-destructive focus:border-destructive focus:ring-destructive',
          )}
        />
        {actionData?.errors?.email && (
          <p className="mt-1 text-xs text-destructive">{actionData.errors.email[0]}</p>
        )}
      </div>

      {/* User Type */}
      <div>
        <label htmlFor="userType" className="mb-1 block text-sm font-medium text-foreground">
          I am a...
        </label>
        <select
          id="userType"
          name="userType"
          required
          defaultValue=""
          className={cn(
            'w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
            actionData?.errors?.userType && 'border-destructive focus:border-destructive focus:ring-destructive',
          )}
        >
          <option value="" disabled>
            Select how you&apos;ll use SureWaka
          </option>
          <option value="sender">Sender</option>
          <option value="business">Business</option>
          <option value="driver">Driver / Logistics Provider</option>
        </select>
        {actionData?.errors?.userType && (
          <p className="mt-1 text-xs text-destructive">{actionData.errors.userType[0]}</p>
        )}
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Joining...' : 'Join the Waitlist'}
      </button>

      {/* General error message */}
      {actionData?.errors && !actionData.success && actionData.message && (
        <p className="text-center text-sm text-destructive">{actionData.message}</p>
      )}
    </Form>
  );
}
