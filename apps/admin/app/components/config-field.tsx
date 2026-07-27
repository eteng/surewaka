import { useState, useEffect } from 'react';
import { z } from 'zod';
import { Lock, Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

type ConfigFieldProps = {
  configKey: string;
  label: string;
  description?: string | null;
  schema: z.ZodTypeAny;
  value: unknown;
  updatedAt: string | null;
  isSaving: boolean;
  justSaved: boolean;
  canWrite: boolean;
  onSave: (key: string, value: unknown) => Promise<boolean>;
  onReset: (key: string) => Promise<boolean>;
};

function getTypeName(schema: z.ZodTypeAny): string {
  return schema._def.typeName as string;
}

function extractNumberConstraints(schema: z.ZodNumber): { min?: number; max?: number } {
  type Check = { kind: string; value?: number };
  const checks = schema._def.checks as Check[];
  return {
    min: checks.find((c) => c.kind === 'min')?.value,
    max: checks.find((c) => c.kind === 'max')?.value,
  };
}

export function ConfigField({
  configKey,
  label,
  description,
  schema,
  value,
  updatedAt,
  isSaving,
  justSaved,
  canWrite,
  onSave,
  onReset,
}: ConfigFieldProps) {
  const [localValue, setLocalValue] = useState<unknown>(value);
  const typeName = getTypeName(schema);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleSave = () => onSave(configKey, localValue);

  const renderControl = () => {
    if (typeName === 'ZodNumber') {
      const { min, max } = extractNumberConstraints(schema as z.ZodNumber);
      return (
        <Input
          type="number"
          min={min}
          max={max}
          value={String(localValue ?? '')}
          disabled={!canWrite || isSaving}
          onChange={(e) => setLocalValue(Number(e.target.value))}
          className="w-32 tabular-nums"
          aria-label={label}
        />
      );
    }
    if (typeName === 'ZodBoolean') {
      return (
        <Switch
          checked={Boolean(localValue)}
          disabled={!canWrite || isSaving}
          onCheckedChange={(checked) => setLocalValue(checked)}
          aria-label={label}
        />
      );
    }
    if (typeName === 'ZodEnum') {
      const options = (schema as z.ZodEnum<[string, ...string[]]>)._def.values as string[];
      return (
        <Select
          value={String(localValue)}
          disabled={!canWrite || isSaving}
          onValueChange={(val) => setLocalValue(val)}
        >
          <SelectTrigger className="w-40" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (typeName === 'ZodString') {
      return (
        <Input
          type="text"
          value={String(localValue ?? '')}
          disabled={!canWrite || isSaving}
          onChange={(e) => setLocalValue(e.target.value)}
          className="w-48"
          aria-label={label}
        />
      );
    }
    if (typeName === 'ZodObject') {
      const shape = (schema as z.ZodObject<z.ZodRawShape>)._def.shape() as Record<
        string,
        z.ZodTypeAny
      >;
      const objValue = (localValue as Record<string, unknown>) ?? {};
      return (
        <div className="space-y-3 pl-4 border-l border-border">
          {Object.entries(shape).map(([subKey, subSchema]) => {
            const constraints =
              getTypeName(subSchema) === 'ZodNumber'
                ? extractNumberConstraints(subSchema as z.ZodNumber)
                : {};
            return (
              <div key={subKey} className="flex items-center gap-3">
                <Label className="w-44 shrink-0 text-xs text-muted-foreground font-mono">
                  {subKey}
                </Label>
                <Input
                  type="number"
                  min={constraints.min}
                  max={constraints.max}
                  value={String(objValue[subKey] ?? '')}
                  disabled={!canWrite || isSaving}
                  onChange={(e) => setLocalValue({ ...objValue, [subKey]: Number(e.target.value) })}
                  className="w-24 tabular-nums"
                  aria-label={subKey}
                />
              </div>
            );
          })}
        </div>
      );
    }
    return <span className="text-xs text-muted-foreground">Unsupported type: {typeName}</span>;
  };

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        <div className="mt-3">{renderControl()}</div>
        {updatedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Updated {new Date(updatedAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        {justSaved && <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />}
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
        {canWrite ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReset(configKey)}
              disabled={isSaving}
              aria-label={`Reset ${label} to default`}
            >
              <RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              Save
            </Button>
          </>
        ) : (
          <span title="Requires superadmin to edit">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}
