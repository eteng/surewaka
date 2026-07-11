import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouteError } from 'react-router';
import { useAuth } from '@clerk/react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  MapPin,
  Loader2,
} from 'lucide-react';
import { createZoneSchema } from '@surewaka/shared';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '~/components/ui/sheet';
import type { Route } from './+types/zones';

// ─── Types ───────────────────────────────────────────────────────────────────

type ZoneRecord = {
  id: string;
  name: string;
  city: string;
  country: string;
  keywords: string[];
  swLat: number | null;
  swLng: number | null;
  neLat: number | null;
  neLng: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ZoneListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ZoneFormData = {
  name: string;
  city: string;
  country: string;
  keywords: string;
  swLat: string;
  swLng: string;
  neLat: string;
  neLng: string;
  isActive: boolean;
};

const EMPTY_FORM: ZoneFormData = {
  name: '',
  city: '',
  country: '',
  keywords: '',
  swLat: '',
  swLng: '',
  neLat: '',
  neLng: '',
  isActive: true,
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const PAGE_SIZE = 20;

// ─── Meta ─────────────────────────────────────────────────────────────────────

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Zone Management' }];
}

// ─── Hook: useZones ──────────────────────────────────────────────────────────

function useZones(params: { page: number; city?: string; country?: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<ZoneRecord[]>([]);
  const [meta, setMeta] = useState<ZoneListMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const paramsKey = JSON.stringify(params);

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); setIsLoading(false); return; }

      const sp = new URLSearchParams();
      sp.set('page', String(params.page));
      sp.set('pageSize', String(PAGE_SIZE));
      if (params.city) sp.set('city', params.city);
      if (params.country) sp.set('country', params.country);

      const res = await fetch(`${API_URL}/api/v1/zones?${sp}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message || `Request failed (${res.status})`);
        setData([]);
        setMeta(null);
        setIsLoading(false);
        return;
      }

      const body = await res.json();
      setData(body.data ?? []);
      setMeta(body.meta ?? null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setData([]);
      setMeta(null);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  useEffect(() => {
    fetchData();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  return { data, meta, isLoading, error, refetch: fetchData };
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function createZone(token: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/api/v1/admin/zones`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

async function updateZone(token: string, id: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/api/v1/admin/zones/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

async function patchZone(token: string, id: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/api/v1/admin/zones/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

// ─── Form Validation Helper ──────────────────────────────────────────────────

function validateZoneForm(form: ZoneFormData) {
  const keywords = form.keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  const payload: Record<string, unknown> = {
    name: form.name,
    city: form.city,
    country: form.country,
    keywords,
    isActive: form.isActive,
  };

  if (form.swLat || form.swLng || form.neLat || form.neLng) {
    payload.swLat = form.swLat ? parseFloat(form.swLat) : null;
    payload.swLng = form.swLng ? parseFloat(form.swLng) : null;
    payload.neLat = form.neLat ? parseFloat(form.neLat) : null;
    payload.neLng = form.neLng ? parseFloat(form.neLng) : null;
  }

  const result = createZoneSchema.safeParse(payload);
  if (!result.success) {
    const firstError = result.error.errors[0];
    return { valid: false, error: firstError?.message || 'Validation failed', payload: null };
  }
  return { valid: true, error: null, payload };
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function ZoneTableSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>
      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <div className="flex gap-8">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-8 border-b px-4 py-4 last:border-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function ZoneEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MapPin className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">No zones found</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        No zones match the current filters. Add a zone to get started with coverage management.
      </p>
      <Button className="mt-6" size="sm" onClick={onAdd}>
        <Plus className="mr-1 h-4 w-4" />
        Add Zone
      </Button>
    </div>
  );
}

// ─── Error With Retry ────────────────────────────────────────────────────────

function ErrorWithRetry({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-muted-foreground">{message ?? 'Failed to load zones'}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ─── Add Zone Modal ──────────────────────────────────────────────────────────

function AddZoneModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { getToken } = useAuth();
  const [form, setForm] = useState<ZoneFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = (field: keyof ZoneFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleSubmit = async () => {
    const { valid, error, payload } = validateZoneForm(form);
    if (!valid || !payload) {
      setFormError(error);
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const token = await getToken();
      if (!token) { setFormError('Not authenticated'); setSubmitting(false); return; }

      const result = await createZone(token, payload);
      if (result.ok) {
        setForm(EMPTY_FORM);
        onSuccess();
        onClose();
      } else if (result.status === 409) {
        setFormError(result.body?.error?.message || 'A zone with this name or keyword already exists');
      } else {
        setFormError(result.body?.error?.message || `Server error (${result.status})`);
      }
    } catch {
      setFormError('Network error — please check your connection and try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Zone</DialogTitle>
          <DialogDescription>
            Create a new coverage zone. At least one keyword is required.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="zone-name">Name</Label>
            <Input
              id="zone-name"
              placeholder="e.g. Lekki"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              aria-invalid={!!formError}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="zone-city">City</Label>
              <Input
                id="zone-city"
                placeholder="e.g. Lagos"
                value={form.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zone-country">Country</Label>
              <Input
                id="zone-country"
                placeholder="e.g. Nigeria"
                value={form.country}
                onChange={(e) => handleChange('country', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="zone-keywords">Keywords (comma-separated)</Label>
            <Input
              id="zone-keywords"
              placeholder="e.g. lekki, ajah, chevron, sangotedo"
              value={form.keywords}
              onChange={(e) => handleChange('keywords', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 1 keyword required. Max 50 keywords, each up to 100 characters.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Bounding Box (optional)</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="SW Latitude"
                value={form.swLat}
                onChange={(e) => handleChange('swLat', e.target.value)}
              />
              <Input
                placeholder="SW Longitude"
                value={form.swLng}
                onChange={(e) => handleChange('swLng', e.target.value)}
              />
              <Input
                placeholder="NE Latitude"
                value={form.neLat}
                onChange={(e) => handleChange('neLat', e.target.value)}
              />
              <Input
                placeholder="NE Longitude"
                value={form.neLng}
                onChange={(e) => handleChange('neLng', e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              If any coordinate is provided, all four are required.
            </p>
          </div>
        </div>

        {formError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{formError}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Zone Detail Panel (Sheet) ───────────────────────────────────────────────

function ZoneDetailPanel({
  zone,
  onClose,
  onSuccess,
}: {
  zone: ZoneRecord | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { getToken } = useAuth();
  const [form, setForm] = useState<ZoneFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (zone) {
      setForm({
        name: zone.name,
        city: zone.city,
        country: zone.country,
        keywords: zone.keywords.join(', '),
        swLat: zone.swLat != null ? String(zone.swLat) : '',
        swLng: zone.swLng != null ? String(zone.swLng) : '',
        neLat: zone.neLat != null ? String(zone.neLat) : '',
        neLng: zone.neLng != null ? String(zone.neLng) : '',
        isActive: zone.isActive,
      });
      setFormError(null);
    }
  }, [zone]);

  const handleChange = (field: keyof ZoneFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleSave = async () => {
    if (!zone) return;
    const { valid, error, payload } = validateZoneForm(form);
    if (!valid || !payload) { setFormError(error); return; }

    setSubmitting(true);
    setFormError(null);

    try {
      const token = await getToken();
      if (!token) { setFormError('Not authenticated'); setSubmitting(false); return; }

      const result = await updateZone(token, zone.id, payload);
      if (result.ok) {
        onSuccess();
        onClose();
      } else if (result.status === 409) {
        setFormError(result.body?.error?.message || 'Conflict — duplicate name or keyword overlap');
      } else {
        setFormError(result.body?.error?.message || `Server error (${result.status})`);
      }
    } catch {
      setFormError('Network error — please check your connection and try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!zone} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Zone</SheetTitle>
          <SheetDescription>Update keywords and bounding box for this zone.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-city">City</Label>
              <Input
                id="edit-city"
                value={form.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-country">Country</Label>
              <Input
                id="edit-country"
                value={form.country}
                onChange={(e) => handleChange('country', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-keywords">Keywords (comma-separated)</Label>
            <Input
              id="edit-keywords"
              value={form.keywords}
              onChange={(e) => handleChange('keywords', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 1 keyword required. Max 50, each up to 100 characters.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Bounding Box (optional)</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="SW Latitude"
                value={form.swLat}
                onChange={(e) => handleChange('swLat', e.target.value)}
              />
              <Input
                placeholder="SW Longitude"
                value={form.swLng}
                onChange={(e) => handleChange('swLng', e.target.value)}
              />
              <Input
                placeholder="NE Latitude"
                value={form.neLat}
                onChange={(e) => handleChange('neLat', e.target.value)}
              />
              <Input
                placeholder="NE Longitude"
                value={form.neLng}
                onChange={(e) => handleChange('neLng', e.target.value)}
              />
            </div>
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{formError}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Active Toggle ───────────────────────────────────────────────────────────

function ActiveToggle({
  zone,
  onToggled,
}: {
  zone: ZoneRecord;
  onToggled: () => void;
}) {
  const { getToken } = useAuth();
  const [toggling, setToggling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setToggling(true);
    setErrorMsg(null);

    try {
      const token = await getToken();
      if (!token) return;

      const result = await patchZone(token, zone.id, { isActive: !zone.isActive });
      if (result.ok) {
        onToggled();
      } else {
        setErrorMsg(result.body?.error?.message || 'Failed to update');
      }
    } catch {
      setErrorMsg('Network error');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={zone.isActive}
        aria-label={`Toggle zone ${zone.name} ${zone.isActive ? 'inactive' : 'active'}`}
        disabled={toggling}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          zone.isActive ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
            zone.isActive ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
      {toggling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {errorMsg && (
        <span className="text-xs text-destructive" title={errorMsg}>!</span>
      )}
    </div>
  );
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────

function FilterBar({
  city,
  country,
  onCityChange,
  onCountryChange,
  cities,
  countries,
  onAdd,
}: {
  city: string;
  country: string;
  onCityChange: (v: string) => void;
  onCountryChange: (v: string) => void;
  cities: string[];
  countries: string[];
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={city} onValueChange={onCityChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All cities" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All cities</SelectItem>
          {cities.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={country} onValueChange={onCountryChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All countries" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All countries</SelectItem>
          {countries.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button className="ml-auto" size="sm" onClick={onAdd}>
        <Plus className="mr-1 h-4 w-4" />
        Add Zone
      </Button>
    </div>
  );
}

// ─── Zone Table ──────────────────────────────────────────────────────────────

function ZoneTable({
  data,
  onRowClick,
  onToggled,
}: {
  data: ZoneRecord[];
  onRowClick: (zone: ZoneRecord) => void;
  onToggled: () => void;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Keywords</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((zone) => (
            <TableRow
              key={zone.id}
              className="cursor-pointer"
              onClick={() => onRowClick(zone)}
            >
              <TableCell className="font-medium">{zone.name}</TableCell>
              <TableCell>{zone.city}</TableCell>
              <TableCell>{zone.country}</TableCell>
              <TableCell>
                <ActiveToggle zone={zone} onToggled={onToggled} />
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{zone.keywords.length}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────

function Pagination({
  meta,
  page,
  onPageChange,
}: {
  meta: ZoneListMeta;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(meta.total / PAGE_SIZE);
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {Math.min(meta.total, PAGE_SIZE)} of {meta.total} zones
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="px-2 text-sm text-muted-foreground">
          {page} / {totalPages || 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function CoverageZonesPage() {
  const [page, setPage] = useState(1);
  const [cityFilter, setCityFilter] = useState('__all__');
  const [countryFilter, setCountryFilter] = useState('__all__');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [detailZone, setDetailZone] = useState<ZoneRecord | null>(null);

  // Known filter options (populated from fetched data)
  const [knownCities, setKnownCities] = useState<string[]>([]);
  const [knownCountries, setKnownCountries] = useState<string[]>([]);

  const { data, meta, isLoading, error, refetch } = useZones({
    page,
    city: cityFilter !== '__all__' ? cityFilter : undefined,
    country: countryFilter !== '__all__' ? countryFilter : undefined,
  });

  // Build unique filter options from loaded data
  useEffect(() => {
    if (data.length > 0) {
      setKnownCities((prev) => {
        const merged = new Set([...prev, ...data.map((z) => z.city)]);
        return Array.from(merged).sort();
      });
      setKnownCountries((prev) => {
        const merged = new Set([...prev, ...data.map((z) => z.country)]);
        return Array.from(merged).sort();
      });
    }
  }, [data]);

  const handleCityChange = (v: string) => {
    setCityFilter(v);
    setPage(1);
  };

  const handleCountryChange = (v: string) => {
    setCountryFilter(v);
    setPage(1);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Zone Management</h1>
        <p className="text-sm text-muted-foreground">
          Manage coverage zones for delivery classification across cities and countries.
        </p>
      </div>

      {/* Loading State */}
      {isLoading && !data.length && <ZoneTableSkeleton />}

      {/* Error State */}
      {error && !isLoading && <ErrorWithRetry message={error} onRetry={refetch} />}

      {/* Content */}
      {!isLoading && !error && (
        <>
          <FilterBar
            city={cityFilter}
            country={countryFilter}
            onCityChange={handleCityChange}
            onCountryChange={handleCountryChange}
            cities={knownCities}
            countries={knownCountries}
            onAdd={() => setAddModalOpen(true)}
          />

          {data.length === 0 ? (
            <ZoneEmptyState onAdd={() => setAddModalOpen(true)} />
          ) : (
            <>
              <ZoneTable
                data={data}
                onRowClick={(zone) => setDetailZone(zone)}
                onToggled={refetch}
              />
              {meta && (
                <Pagination meta={meta} page={page} onPageChange={setPage} />
              )}
            </>
          )}
        </>
      )}

      {/* Add Zone Modal */}
      <AddZoneModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={refetch}
      />

      {/* Detail Panel (Sheet) */}
      <ZoneDetailPanel
        zone={detailZone}
        onClose={() => setDetailZone(null)}
        onSuccess={refetch}
      />
    </div>
  );
}

// ─── Error Boundary ──────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-center max-w-md">
        We've been notified and are looking into it. Try refreshing the page.
      </p>
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </div>
  );
}
