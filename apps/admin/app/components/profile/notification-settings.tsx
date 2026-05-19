import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mail, MessageSquare } from 'lucide-react';

type NotificationSettingsProps = {
  notificationEmail: boolean;
  notificationSms: boolean;
  onUpdate: (data: { notificationEmail?: boolean; notificationSms?: boolean }) => Promise<void>;
  isUpdating: boolean;
};

export function NotificationSettings({
  notificationEmail,
  notificationSms,
  onUpdate,
  isUpdating,
}: NotificationSettingsProps) {
  const [emailEnabled, setEmailEnabled] = useState(notificationEmail);
  const [smsEnabled, setSmsEnabled] = useState(notificationSms);
  const [savedField, setSavedField] = useState<'email' | 'sms' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setEmailEnabled(notificationEmail);
    setSmsEnabled(notificationSms);
  }, [notificationEmail, notificationSms]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const showSavedFeedback = useCallback((field: 'email' | 'sms') => {
    setSavedField(field);
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setSavedField(null);
    }, 2000);
  }, []);

  async function handleEmailToggle() {
    const newValue = !emailEnabled;
    setEmailEnabled(newValue);
    setError(null);

    try {
      await onUpdate({ notificationEmail: newValue });
      showSavedFeedback('email');
    } catch {
      setEmailEnabled(!newValue);
      setError('Failed to update email notifications');
    }
  }

  async function handleSmsToggle() {
    const newValue = !smsEnabled;
    setSmsEnabled(newValue);
    setError(null);

    try {
      await onUpdate({ notificationSms: newValue });
      showSavedFeedback('sms');
    } catch {
      setSmsEnabled(!newValue);
      setError('Failed to update SMS notifications');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Notifications</h3>
        <p className="text-sm text-muted-foreground">
          Choose how you want to receive notifications.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Email notifications</p>
              <p className="text-xs text-muted-foreground">Receive updates via email</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {savedField === 'email' && (
              <span className="flex items-center gap-1 text-xs text-green-600 animate-in fade-in">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={emailEnabled}
              aria-label="Toggle email notifications"
              disabled={isUpdating}
              onClick={handleEmailToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                emailEnabled ? 'bg-primary' : 'bg-input'
              }`}
            >
              {isUpdating ? (
                <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                    emailEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">SMS notifications</p>
              <p className="text-xs text-muted-foreground">Receive updates via text message</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {savedField === 'sms' && (
              <span className="flex items-center gap-1 text-xs text-green-600 animate-in fade-in">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={smsEnabled}
              aria-label="Toggle SMS notifications"
              disabled={isUpdating}
              onClick={handleSmsToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                smsEnabled ? 'bg-primary' : 'bg-input'
              }`}
            >
              {isUpdating ? (
                <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                    smsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
