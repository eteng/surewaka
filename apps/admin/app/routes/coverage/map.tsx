import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertCircle, Map, RefreshCw } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { Badge } from '~/components/ui/badge';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type CoverageFeature = {
  type: 'Feature';
  properties: {
    h3Index: string;
    parkCount: number;
    demandCount: number;
    driverCount: number;
    center: { lat: number; lng: number };
    type: 'covered' | 'gap' | 'active';
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
};

type CoverageGeoJSON = {
  type: 'FeatureCollection';
  features: CoverageFeature[];
};

export default function CoverageMapRoute() {
  const { getToken } = useAuth();
  const [data, setData] = useState<CoverageGeoJSON | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/coverage-map`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coverage map');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const parkCount = data?.features.filter((f) => f.properties.parkCount > 0).length ?? 0;
  const driverCount = data?.features.filter((f) => f.properties.driverCount > 0).length ?? 0;
  const gapCount =
    data?.features.filter((f) => f.properties.demandCount > 0 && f.properties.parkCount === 0)
      .length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Coverage Map</h1>
          <p className="text-sm text-muted-foreground">
            Unified view of carrier parks, active drivers, and coverage gaps (H3 hexagons)
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

      {isLoading && !data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-[400px] rounded-lg" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <span className="text-sm font-medium">Carrier Parks</span>
              </div>
              <p className="mt-2 text-2xl font-bold">{parkCount}</p>
              <p className="text-xs text-muted-foreground">H3 hexagons with carrier presence</p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-sm font-medium">Active Drivers</span>
              </div>
              <p className="mt-2 text-2xl font-bold">{driverCount}</p>
              <p className="text-xs text-muted-foreground">H3 hexagons with available drivers</p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-sm font-medium">Coverage Gaps</span>
              </div>
              <p className="mt-2 text-2xl font-bold">{gapCount}</p>
              <p className="text-xs text-muted-foreground">Areas with unmet demand</p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/50 p-8 text-center">
            <Map className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Map visualization coming soon. GeoJSON data available via API.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge variant="secondary">{data.features.length} total features</Badge>
              <Badge variant="outline">H3 Resolution 7</Badge>
            </div>
          </div>

          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Raw GeoJSON ({data.features.length} features)
            </summary>
            <pre className="mt-4 max-h-[300px] overflow-auto rounded bg-muted p-4 text-xs">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
