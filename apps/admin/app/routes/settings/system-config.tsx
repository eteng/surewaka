import { useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { Download, Upload, SlidersHorizontal } from 'lucide-react';
import { configRegistry } from '@surewaka/shared';
import type { ConfigKey } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { ConfigField } from '~/components/config-field';
import { useSystemConfig } from '~/hooks/use-system-config';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'SureWaka Admin - System Config' }];

// Group registry keys by category
const grouped = Object.entries(configRegistry).reduce<
  Record<string, Array<{ key: string; entry: (typeof configRegistry)[ConfigKey] }>>
>((acc, [key, entry]) => {
  const cat = entry.category;
  if (!acc[cat]) acc[cat] = [];
  acc[cat].push({ key, entry: entry as (typeof configRegistry)[ConfigKey] });
  return acc;
}, {});

const CATEGORY_LABELS: Record<string, string> = {
  matching: 'Driver Matching Engine',
  routing: 'Routing & Path Optimization',
  pricing: 'Pricing & Fees',
};

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
  } = useSystemConfig();

  const importRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportStatus(null);
    try {
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

  const itemMap = new Map(items.map((i) => [i.key, i]));

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
            onChange={handleImport}
          />
        </div>
      </div>

      {importStatus && <p className="mt-3 text-sm text-green-600">{importStatus}</p>}
      {importError && <p className="mt-3 text-sm text-destructive">{importError}</p>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-6 space-y-6">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))
          : Object.entries(grouped).map(([category, keys]) => {
              if (keys.length === 0) return null;
              return (
                <section key={category} className="rounded-xl border border-border bg-card p-6">
                  <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    {CATEGORY_LABELS[category] ?? category}
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
            })}
      </div>
    </div>
  );
}
