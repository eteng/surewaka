import { useEffect, useRef, useState } from 'react';
import { useRouteError } from 'react-router';
import { useUser } from '@clerk/react';
import {
  AlertCircle,
  DollarSign,
  Download,
  Gauge,
  RefreshCw,
  Route,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { configRegistry } from '@surewaka/shared';
import type { ConfigKey } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog';
import { ConfigField } from '~/components/config-field';
import { useSystemConfig } from '~/hooks/use-system-config';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'SureWaka Admin - System Config' }];

// ─── Error Boundary ────────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();
  // TODO: Replace with Sentry.captureException(error) once Sentry is set up
  console.error('[SystemConfig ErrorBoundary]', error);
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">
        Failed to load System Config. We've been notified and are looking into it.
      </p>
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </div>
  );
}

// ─── Category Grouping ─────────────────────────────────────────────────────────

const grouped = Object.entries(configRegistry).reduce<
  Record<string, Array<{ key: string; entry: (typeof configRegistry)[ConfigKey] }>>
>((acc, [key, entry]) => {
  const cat = entry.category;
  if (!acc[cat]) acc[cat] = [];
  acc[cat].push({ key, entry: entry as (typeof configRegistry)[ConfigKey] });
  return acc;
}, {});

const CATEGORY_META: Record<string, { label: string; icon: typeof Gauge }> = {
  matching: { label: 'Driver Matching Engine', icon: Gauge },
  routing: { label: 'Routing & Path Optimization', icon: Route },
  pricing: { label: 'Pricing & Fees', icon: DollarSign },
};

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SystemConfig() {
  const { user } = useUser();
  const canWrite = ((user?.publicMetadata?.roles as string[]) ?? []).includes(
    'surewaka_superadmin',
  );

  const {
    items,
    isLoading,
    error,
    saving,
    saveSuccess,
    saveConfig,
    resetConfig,
    exportConfig,
    importConfig,
    refetch,
  } = useSystemConfig();

  const importRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-dismiss import success after 5s
  useEffect(() => {
    if (!importStatus) return;
    const timer = setTimeout(() => setImportStatus(null), 5000);
    return () => clearTimeout(timer);
  }, [importStatus]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportStatus(null);

    // Validate file extension
    if (!file.name.endsWith('.json')) {
      setImportError('Please select a .json file');
      if (importRef.current) importRef.current.value = '';
      return;
    }

    try {
      const text = await file.text();

      // Validate JSON syntax
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setImportError('Invalid JSON format — please check the file syntax');
        return;
      }

      // Validate shape: must be a flat object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setImportError('Expected a flat JSON object with config key/value pairs');
        return;
      }

      const result = await importConfig(file);
      if (result) {
        setImportStatus(`Imported ${result.imported} keys, skipped ${result.skipped}`);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const handleResetAll = async () => {
    const allKeys = Object.keys(configRegistry);
    for (const key of allKeys) {
      await resetConfig(key);
    }
  };

  const itemMap = new Map(items.map((i) => [i.key, i]));

  // Filter grouped entries by search query
  const filteredGrouped = Object.entries(grouped).reduce<
    Record<string, Array<{ key: string; entry: (typeof configRegistry)[ConfigKey] }>>
  >((acc, [category, keys]) => {
    if (!searchQuery.trim()) {
      acc[category] = keys;
      return acc;
    }
    const q = searchQuery.toLowerCase();
    const filtered = keys.filter(
      ({ key, entry }) =>
        key.toLowerCase().includes(q) ||
        entry.label.toLowerCase().includes(q) ||
        ('description' in entry && (entry.description as string)?.toLowerCase().includes(q)),
    );
    if (filtered.length > 0) acc[category] = filtered;
    return acc;
  }, {});

  return (
    <div className="pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Config</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational parameters — changes take effect within 5 minutes in workers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportConfig} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canWrite || isLoading}
            title={canWrite ? undefined : 'Requires superadmin'}
            onClick={() => importRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Import
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import config file"
            onChange={handleImport}
          />
          {canWrite && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={isLoading}>
                  <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
                  Reset All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset all config to defaults?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will revert every config key to its default value. This action cannot be
                    undone — any customized settings will be lost.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetAll}>
                    Reset All to Defaults
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Status banners with accessibility */}
      <div aria-live="polite" aria-atomic="true">
        {importStatus && (
          <p className="mt-3 text-sm text-green-600" role="status">
            {importStatus}
          </p>
        )}
      </div>
      <div aria-live="assertive" aria-atomic="true">
        {importError && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {importError}
          </p>
        )}
        {error && (
          <div className="mt-3 flex items-center gap-3" role="alert">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}
      </div>

      {/* Search/filter */}
      <div className="mt-4 relative max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Filter config keys..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          aria-label="Filter config keys"
        />
      </div>

      <div className="mt-6 space-y-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))
        ) : Object.keys(filteredGrouped).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground mb-3" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No config keys match &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        ) : (
          Object.entries(filteredGrouped).map(([category, keys]) => {
            const meta = CATEGORY_META[category] ?? {
              label: category,
              icon: SlidersHorizontal,
            };
            const Icon = meta.icon;
            return (
              <section key={category} className="rounded-xl border border-border bg-card p-6">
                <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {meta.label}
                </h2>
                <div className="mt-4 space-y-3">
                  {keys.map(({ key, entry }) => {
                    const item = itemMap.get(key);
                    return (
                      <ConfigField
                        key={key}
                        configKey={key}
                        label={entry.label}
                        description={
                          'description' in entry ? (entry.description as string) : undefined
                        }
                        schema={entry.schema}
                        value={item?.value ?? entry.default}
                        updatedAt={item?.updatedAt ?? null}
                        isSaving={saving === key}
                        justSaved={saveSuccess === key}
                        canWrite={canWrite}
                        onSave={saveConfig}
                        onReset={resetConfig}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
