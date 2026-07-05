import { useState } from 'react';
import { AlertTriangle, Bell, Smartphone, TestTube, Webhook } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import { useAlertSettings } from '~/hooks/use-alert-settings';
import type { AlertSettings } from '@surewaka/shared';

export function meta() {
  return [{ title: 'SureWaka Admin - Alert Settings' }];
}

type ThresholdField = keyof Pick<
  AlertSettings,
  | 'driverSilentWarningMin'
  | 'driverSilentCriticalMin'
  | 'legOverdueWarningMin'
  | 'legOverdueCriticalMin'
  | 'customerUpdateGapWarningMin'
  | 'customerUpdateGapCriticalMin'
  | 'ontimeRateWarningPct'
  | 'ontimeRateCriticalPct'
>;

type ThresholdConfig = {
  label: string;
  field: ThresholdField;
  min: number;
  max: number;
  unit: string;
};

const THRESHOLD_CONFIGS: ThresholdConfig[] = [
  { label: 'Driver Silent Warning', field: 'driverSilentWarningMin', min: 5, max: 60, unit: 'min' },
  { label: 'Driver Silent Critical', field: 'driverSilentCriticalMin', min: 10, max: 120, unit: 'min' },
  { label: 'Leg Overdue Warning', field: 'legOverdueWarningMin', min: 10, max: 120, unit: 'min' },
  { label: 'Leg Overdue Critical', field: 'legOverdueCriticalMin', min: 20, max: 240, unit: 'min' },
  { label: 'Customer Update Gap Warning', field: 'customerUpdateGapWarningMin', min: 15, max: 120, unit: 'min' },
  { label: 'Customer Update Gap Critical', field: 'customerUpdateGapCriticalMin', min: 30, max: 240, unit: 'min' },
  { label: 'On-Time Rate Warning', field: 'ontimeRateWarningPct', min: 50, max: 100, unit: '%' },
  { label: 'On-Time Rate Critical', field: 'ontimeRateCriticalPct', min: 30, max: 90, unit: '%' },
];

function AlertSettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default function AlertSettingsPage() {
  const { settings, isLoading, isSaving, error, saveSettings, sendTestAlert } = useAlertSettings();
  const [testSent, setTestSent] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string>('');

  const handleTestAlert = async () => {
    const ok = await sendTestAlert();
    if (ok) {
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="pt-4">
        <AlertSettingsSkeleton />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="pt-4">
        <h1 className="text-2xl font-bold text-foreground">Alert Settings</h1>
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{error ?? 'Failed to load alert settings.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Alert Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure thresholds and notification routing for operational alerts.
      </p>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="mt-6 space-y-6">
        {/* ─── Alert Thresholds ───────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Bell className="h-4 w-4" aria-hidden="true" />
            Alert Thresholds
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nigerian network conditions: the driver silent threshold is intentionally generous for
            connectivity drops in Lagos traffic.
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {THRESHOLD_CONFIGS.map(({ label, field, min, max, unit }) => {
              const value = settings[field];
              return (
                <div key={field} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={field} className="text-sm font-medium">
                      {label}
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {unit === '%' ? `${value}${unit}` : `${value} ${unit}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field}
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      value={value}
                      disabled={isSaving}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value, 10);
                        if (!isNaN(parsed) && parsed >= min && parsed <= max) {
                          saveSettings({ [field]: parsed });
                        }
                      }}
                      className="w-24 tabular-nums"
                      aria-label={label}
                    />
                    <span className="text-xs text-muted-foreground">{unit}</span>
                    <span className="text-xs text-muted-foreground">
                      ({min}–{max})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ─── Pumble Webhook ─────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Webhook className="h-4 w-4" aria-hidden="true" />
            Pumble Webhook
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Critical alerts are posted to this channel. Warning and Info alerts stay in-app only.
          </p>

          <div className="mt-4 space-y-4">
            {/* Pumble enabled toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="pumble-enabled" className="text-sm font-medium">
                Enable Pumble alerts
              </Label>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  id="pumble-enabled"
                  type="checkbox"
                  checked={settings.pumbleEnabled}
                  disabled={isSaving}
                  onChange={(e) => saveSettings({ pumbleEnabled: e.target.checked })}
                  className="peer sr-only"
                />
                <div
                  className={cn(
                    'h-5 w-9 rounded-full border-2 transition-colors',
                    'peer-checked:border-primary peer-checked:bg-primary',
                    'border-input bg-input',
                    'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                  )}
                />
                <div
                  className={cn(
                    'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
                    'peer-checked:translate-x-4',
                  )}
                />
              </label>
            </div>

            {/* Webhook URL input */}
            <div
              className={cn(
                'space-y-2 transition-opacity',
                !settings.pumbleEnabled && 'pointer-events-none opacity-50',
              )}
            >
              <Label htmlFor="pumble-url" className="text-sm">
                Incoming webhook URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="pumble-url"
                  type="url"
                  placeholder="https://api.pumble.com/workspaces/.../incoming-webhooks/..."
                  defaultValue={settings.pumbleWebhookUrl ?? ''}
                  onChange={(e) => setPendingUrl(e.target.value)}
                  className="font-mono text-xs"
                  disabled={isSaving || !settings.pumbleEnabled}
                  aria-label="Pumble webhook URL"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveSettings({ pumbleWebhookUrl: pendingUrl || null })}
                  disabled={isSaving || !pendingUrl || !settings.pumbleEnabled}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Push Notifications ─────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            Push Notifications
          </h2>

          <div className="mt-4 flex items-start justify-between">
            <div>
              <Label htmlFor="push-enabled" className="text-sm font-medium">
                Enable push alerts
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Sends to all admin users with registered devices. Critical alerts only.
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                id="push-enabled"
                type="checkbox"
                checked={settings.pushEnabled}
                disabled={isSaving}
                onChange={(e) => saveSettings({ pushEnabled: e.target.checked })}
                className="peer sr-only"
              />
              <div
                className={cn(
                  'h-5 w-9 rounded-full border-2 transition-colors',
                  'peer-checked:border-primary peer-checked:bg-primary',
                  'border-input bg-input',
                  'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                )}
              />
              <div
                className={cn(
                  'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
                  'peer-checked:translate-x-4',
                )}
              />
            </label>
          </div>

          {/* WhatsApp placeholder */}
          <div className="mt-5 rounded-lg border border-dashed border-border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">WhatsApp Business</span> — coming soon.
              Configure a BSP account (Twilio, Vonage) to route critical alerts to a WhatsApp
              channel. Use the Pumble webhook as the recommended channel in the meantime.
            </p>
          </div>
        </section>

        {/* ─── Test Alert ─────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <TestTube className="h-4 w-4" aria-hidden="true" />
            Test Alert
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sends a dummy Critical alert through all configured channels to verify routing works.
            Run this before going live.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={handleTestAlert}
            disabled={isSaving}
            aria-label="Send test alert"
          >
            {testSent ? '✓ Test alert sent' : 'Send test alert'}
          </Button>
        </section>
      </div>
    </div>
  );
}
