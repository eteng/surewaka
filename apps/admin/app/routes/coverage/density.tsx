import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertCircle, RefreshCw, Users } from 'lucide-react';
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

type DensityCell = {
  h3Index: string;
  driverCount: number;
};

export default function DriverDensityRoute() {
  const { getToken } = useAuth();
  const [cells, setCells] = useState<DensityCell[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/driver-density`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCells(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load driver density');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalDrivers = cells.reduce((sum, c) => sum + c.driverCount, 0);
  const maxDensity = Math.max(...cells.map((c) => c.driverCount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Driver Density</h1>
          <p className="text-sm text-muted-foreground">
            Available driver distribution across H3 hexagons (real-time)
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

      {isLoading && !cells.length && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && !error && cells.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12">
          <Users className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No active drivers with known locations</p>
          <p className="text-xs text-muted-foreground">
            Drivers appear here when they have an h3_index and are marked available
          </p>
        </div>
      )}

      {cells.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium text-muted-foreground">Total Active Drivers</p>
              <p className="mt-1 text-2xl font-bold">{totalDrivers}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium text-muted-foreground">Covered Hexagons</p>
              <p className="mt-1 text-2xl font-bold">{cells.length}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium text-muted-foreground">Max Density</p>
              <p className="mt-1 text-2xl font-bold">{maxDensity} drivers/cell</p>
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>H3 Cell</TableHead>
                  <TableHead>Drivers</TableHead>
                  <TableHead>Density</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cells.map((cell) => (
                  <TableRow key={cell.h3Index}>
                    <TableCell className="font-mono text-xs">{cell.h3Index}</TableCell>
                    <TableCell>{cell.driverCount}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 max-w-[100px] rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-green-500"
                            style={{
                              width: `${maxDensity > 0 ? (cell.driverCount / maxDensity) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {maxDensity > 0
                            ? `${Math.round((cell.driverCount / maxDensity) * 100)}%`
                            : '0%'}
                        </Badge>
                      </div>
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
