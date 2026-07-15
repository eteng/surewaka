import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Skeleton } from '~/components/ui/skeleton';
import { useFeeSettings } from '~/hooks/use-fee-settings';
import type { MetaFunction } from 'react-router';
import type { VehicleType } from '@surewaka/shared';

export const meta: MetaFunction = () => [{ title: 'SureWaka Admin - Fee Settings' }];

// ─── Fee Setting Field Configs ────────────────────────────────────────────────

type FeeField = {
  key: string;
  label: string;
  description: string;
  unit: 'kobo' | 'naira' | '%' | 'min';
  min: number;
  max: number;
  step: number;
};

const FEE_FIELDS: FeeField[] = [
  {
    key: 'baseRateKobo',
    label: 'Base Rate',
    description: 'Flat pickup fee per on-demand leg',
    unit: 'naira',
    min: 0,
    max: 10000000,
    step: 100,
  },
  {
    key: 'perKgRateKobo',
    label: 'Per-Kg Rate',
    description: 'Charge per kilogram of package weight',
    unit: 'naira',
    min: 0,
    max: 1000000,
    step: 100,
  },
  {
    key: 'perKmRateKobo',
    label: 'Per-Km Rate',
    description: 'Charge per kilometre of distance',
    unit: 'naira',
    min: 0,
    max: 1000000,
    step: 100,
  },
  {
    key: 'carrierCommissionRatePct',
    label: 'Carrier Commission',
    description: 'Additive markup on carrier base price',
    unit: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'taxRatePct',
    label: 'Tax Rate',
    description: 'Applied only to SureWaka revenue lines',
    unit: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'minPriceKobo',
    label: 'Minimum Price',
    description: 'Floor on composite delivery total',
    unit: 'naira',
    min: 0,
    max: 10000000,
    step: 100,
  },
  {
    key: 'withdrawalFeeKobo',
    label: 'Withdrawal Fee',
    description: 'Flat fee charged per payout request (covers Paystack transfer cost)',
    unit: 'naira',
    min: 0,
    max: 100000,
    step: 100,
  },
  {
    key: 'weightCorrectionApprovalWindowMin',
    label: 'Weight Correction Window',
    description: 'Time customer has to approve a weight discrepancy',
    unit: 'min',
    min: 1,
    max: 60,
    step: 1,
  },
];

// ─── Vehicle Type Display Configs ─────────────────────────────────────────────

const VEHICLE_TYPE_LABELS: Record<VehicleType, { label: string; description: string }> = {
  motorcycle: { label: 'Motorcycle', description: 'Small parcels, documents' },
  car: { label: 'Car', description: 'Medium packages' },
  van: { label: 'Van', description: 'Large items, bulk orders' },
  truck: { label: 'Truck', description: 'Heavy/oversized cargo' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function koboToNaira(kobo: number): string {
  return (kobo / 100).toFixed(2);
}

function nairaToKobo(naira: string): number {
  return Math.round(parseFloat(naira) * 100);
}

function formatDisplayValue(value: number, unit: FeeField['unit']): string {
  switch (unit) {
    case 'naira':
      return `₦${koboToNaira(value)}`;
    case 'kobo':
      return `${value} kobo`;
    case '%':
      return `${value}%`;
    case 'min':
      return `${value} min`;
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function FeeSettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function FeeSettingsPage() {
  const {
    settings,
    vehicleTypeRates,
    isLoading,
    isSaving,
    isSavingRate,
    error,
    saveSuccess,
    rateSuccess,
    saveSettings,
    saveVehicleTypeRate,
    refetch,
  } = useFeeSettings();

  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [localRates, setLocalRates] = useState<Record<VehicleType, string>>(
    {} as Record<VehicleType, string>,
  );
  const initializedRef = useRef(false);

  // Sync initial settings to local state
  useEffect(() => {
    if (settings && !initializedRef.current) {
      initializedRef.current = true;
      const values: Record<string, string> = {};
      for (const field of FEE_FIELDS) {
        const rawValue = (settings as Record<string, unknown>)[field.key];
        const numValue = typeof rawValue === 'string' ? parseFloat(rawValue) : Number(rawValue);
        if (field.unit === 'naira') {
          values[field.key] = koboToNaira(numValue);
        } else {
          values[field.key] = String(numValue);
        }
      }
      setLocalValues(values);
    }
  }, [settings]);

  // Sync vehicle type rates to local state
  useEffect(() => {
    if (vehicleTypeRates.length > 0) {
      const rates: Record<string, string> = {};
      for (const row of vehicleTypeRates) {
        rates[row.vehicleType] = String(parseFloat(row.multiplier));
      }
      setLocalRates(rates as Record<VehicleType, string>);
    }
  }, [vehicleTypeRates]);

  const handleFeeFieldSave = async (fieldKey: string, field: FeeField) => {
    const localValue = localValues[fieldKey];
    if (localValue === undefined) return;

    let numericValue: number;
    if (field.unit === 'naira') {
      numericValue = nairaToKobo(localValue);
    } else {
      numericValue = parseFloat(localValue);
    }

    if (isNaN(numericValue) || numericValue < field.min || numericValue > field.max) {
      // Reset to server value
      const rawValue = (settings as Record<string, unknown>)?.[fieldKey];
      const serverNum = typeof rawValue === 'string' ? parseFloat(rawValue) : Number(rawValue);
      setLocalValues((prev) => ({
        ...prev,
        [fieldKey]: field.unit === 'naira' ? koboToNaira(serverNum) : String(serverNum),
      }));
      return;
    }

    await saveSettings({ [fieldKey]: numericValue });
  };

  const handleRateSave = async (vehicleType: VehicleType) => {
    const localValue = localRates[vehicleType];
    if (localValue === undefined) return;

    const multiplier = parseFloat(localValue);
    if (isNaN(multiplier) || multiplier <= 0) {
      // Reset to server value
      const serverRow = vehicleTypeRates.find((r) => r.vehicleType === vehicleType);
      if (serverRow) {
        setLocalRates((prev) => ({ ...prev, [vehicleType]: String(parseFloat(serverRow.multiplier)) }));
      }
      return;
    }

    await saveVehicleTypeRate(vehicleType, multiplier);
  };

  if (isLoading) {
    return (
      <div className="pt-4">
        <FeeSettingsSkeleton />
      </div>
    );
  }

  if (!settings && error) {
    return (
      <div className="pt-4">
        <h1 className="text-2xl font-bold text-foreground">Fee Settings</h1>
        <div className="mt-6 flex flex-col items-center gap-3 py-8">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fee Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure on-demand rates, carrier commission, tax, and vehicle type multipliers.
          </p>
        </div>
        {saveSuccess && (
          <div className="flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-1.5 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Saved
          </div>
        )}
      </div>

      {/* Forward-only notice */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Changes apply only to future quotes — existing quotes are unaffected.
        </p>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="mt-6 space-y-6">
        {/* ─── Fee Parameters ──────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Banknote className="h-4 w-4" aria-hidden="true" />
            Fee Parameters
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Core pricing inputs for on-demand legs and carrier commission. Monetary values are
            shown in naira.
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {FEE_FIELDS.map((field) => {
              const localValue = localValues[field.key] ?? '';
              const rawServerValue = settings
                ? (settings as Record<string, unknown>)[field.key]
                : undefined;
              const serverNum =
                typeof rawServerValue === 'string'
                  ? parseFloat(rawServerValue)
                  : Number(rawServerValue ?? 0);
              const displayValue =
                field.unit === 'naira'
                  ? formatDisplayValue(serverNum, field.unit)
                  : formatDisplayValue(serverNum, field.unit);

              return (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={field.key} className="text-sm font-medium">
                      {field.label}
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {displayValue}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field.key}
                      type="number"
                      min={field.unit === 'naira' ? field.min / 100 : field.min}
                      max={field.unit === 'naira' ? field.max / 100 : field.max}
                      step={field.unit === 'naira' ? 0.01 : field.step}
                      value={localValue}
                      disabled={isSaving}
                      onChange={(e) =>
                        setLocalValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      onBlur={() => handleFeeFieldSave(field.key, field)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleFeeFieldSave(field.key, field);
                        }
                      }}
                      className="w-32 tabular-nums"
                      aria-label={field.label}
                      aria-describedby={`${field.key}-unit`}
                    />
                    <span id={`${field.key}-unit`} className="text-xs text-muted-foreground">
                      {field.unit === 'naira' ? '₦' : field.unit}
                    </span>
                    {isSaving && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ─── Vehicle Type Rates ──────────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Truck className="h-4 w-4" aria-hidden="true" />
            Vehicle Type Multipliers
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each on-demand leg subtotal is multiplied by this factor before tax. A value of 1.0
            means no markup; 2.0 doubles the subtotal.
          </p>

          <div className="mt-6 space-y-4">
            {(['motorcycle', 'car', 'van', 'truck'] as VehicleType[]).map((type) => {
              const config = VEHICLE_TYPE_LABELS[type];
              const localValue = localRates[type] ?? '';
              const isSavingThis = isSavingRate === type;
              const justSaved = rateSuccess === type;

              return (
                <div
                  key={type}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-4"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{config.label}</p>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0.01}
                      max={10}
                      step={0.01}
                      value={localValue}
                      disabled={isSavingThis}
                      onChange={(e) =>
                        setLocalRates((prev) => ({ ...prev, [type]: e.target.value }))
                      }
                      onBlur={() => handleRateSave(type)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleRateSave(type);
                        }
                      }}
                      className="w-24 tabular-nums"
                      aria-label={`${config.label} multiplier`}
                    />
                    <span className="text-xs text-muted-foreground">×</span>
                    {isSavingThis && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    )}
                    {justSaved && (
                      <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
