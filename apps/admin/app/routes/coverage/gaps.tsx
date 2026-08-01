import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { Badge } from '~/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type CoverageGap = {
  id: string;
  h3Index: string;
  demandCount: number;
  nearestParkKm: number | null;
  nearestDriverKm: number | null;
  detectedAt: string;
  resolvedAt: string | null;
};

export default function CoverageGapsRoute() {
  const { getToken } = useAuth();
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/coverage-gaps`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setGaps(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coverage gaps');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const activeGaps = gaps.filter((g) => !g.resolvedAt);
  const resolvedGaps = gaps.filter((g) => g.resolvedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Coverage Gaps</h1>
          <p className="text-sm text-muted-foreground">
            Areas with delivery demand but no carrier parks or drivers nearby
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="ml-auto" onClick={fetchData}>
            Retry
          </Button>
        </div>
      )}

      {isLoading && !gaps.length && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && !error && gaps.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12">
          <AlertTriangle className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No coverage gaps detected</p>
          <p className="text-xs text-muted-foreground">
            Gaps are computed every 6 hours by the cron worker
          </p>
        </div>
      )}

      {gaps.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium text-muted-foreground">Active Gaps</p>
              <p className="mt-1 text-2xl font-bold text-destructive">{activeGaps.length}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium text-muted-foreground">Resolved</p>
              <p className="mt-1 text-2xl font-bold text-green-600">{resolvedGaps.length}</p>
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>H3 Cell</TableHead>
                  <TableHead>Demand</TableHead>
                  <TableHead>Nearest Park</TableHead>
                  <TableHead>Nearest Driver</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gaps.map((gap) => (
                  <TableRow key={gap.id}>
                    <TableCell className="font-mono text-xs">{gap.h3Index}</TableCell>
                    <TableCell>
                      <Badge variant={gap.demandCount > 10 ? 'destructive' : 'secondary'}>
                        {gap.demandCount} requests
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {gap.nearestParkKm != null ? `${gap.nearestParkKm.toFixed(1)} km` : '—'}
                    </TableCell>
                    <TableCell>
                      {gap.nearestDriverKm != null
                        ? `${gap.nearestDriverKm.toFixed(1)} km`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(gap.detectedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {gap.resolvedAt ? (
                        <Badge variant="outline" className="text-green-600">
                          Resolved
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
