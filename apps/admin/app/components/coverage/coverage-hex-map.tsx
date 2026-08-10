import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import 'mapbox-gl/dist/mapbox-gl.css';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CoverageFeature = {
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

export type CoverageGeoJSON = {
  type: 'FeatureCollection';
  features: CoverageFeature[];
};

type CoverageHexMapProps = {
  data: CoverageGeoJSON | null;
  isLoading: boolean;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const HEX_COLORS = {
  covered: '#3b82f6',
  gap: '#ef4444',
  active: '#22c55e',
} as const;

const NIGERIA_CENTER = { latitude: 9.0, longitude: 7.5, zoom: 5 };

// ─── Bounds calculation ────────────────────────────────────────────────────────

function calculateHexBounds(
  features: CoverageFeature[],
): { sw: [number, number]; ne: [number, number] } | null {
  if (features.length === 0) return null;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    for (const ring of feature.geometry.coordinates) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  const padding = 0.05;
  return {
    sw: [minLng - padding, minLat - padding],
    ne: [maxLng + padding, maxLat + padding],
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function CoverageHexMap({ data, isLoading }: CoverageHexMapProps) {
  const [mapAvailable, setMapAvailable] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<CoverageFeature | null>(null);
  const mapRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkMapAvailability() {
      try {
        // Dynamic import with variable to prevent bundler resolution errors.
        // Must use the `/mapbox` subpath — the package has no root `.` export.
        const pkg = 'react-map-gl/mapbox';
        await import(/* @vite-ignore */ pkg);
        if (!cancelled) setMapAvailable(true);
      } catch {
        if (!cancelled) setMapAvailable(false);
      }
    }
    checkMapAvailability();
    return () => {
      cancelled = true;
    };
  }, []);

  const features = useMemo(() => data?.features ?? [], [data]);
  const bounds = useMemo(() => calculateHexBounds(features), [features]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border bg-muted/30">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }

  if (mapAvailable === null) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border bg-muted/30">
        <p className="text-sm text-muted-foreground">Initializing map...</p>
      </div>
    );
  }

  if (mapAvailable === false) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-lg border bg-muted/10">
        <MapPin className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">
          Map view requires react-map-gl
        </p>
        {features.length > 0 && (
          <p className="text-xs text-muted-foreground/70">
            {features.length} hexes ready to display
          </p>
        )}
      </div>
    );
  }

  if (features.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border bg-muted/10">
        <p className="text-sm text-muted-foreground">No coverage data to display</p>
      </div>
    );
  }

  return (
    <div className="relative h-96 overflow-hidden rounded-lg border">
      <HexLegend />
      <HexMapRenderer
        data={data as CoverageGeoJSON}
        bounds={bounds}
        selected={selected}
        onSelect={setSelected}
        mapRef={mapRef}
      />
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function HexLegend() {
  return (
    <div className="absolute left-3 top-3 z-10 rounded-md border bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex flex-col gap-1.5">
        <LegendRow color={HEX_COLORS.covered} label="Carrier coverage" />
        <LegendRow color={HEX_COLORS.gap} label="Coverage gap" />
        <LegendRow color={HEX_COLORS.active} label="Drivers only" />
      </div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs text-foreground">{label}</span>
    </div>
  );
}

// ─── Dynamic Map Renderer (uses react-map-gl when available) ───────────────────

type HexMapRendererProps = {
  data: CoverageGeoJSON;
  bounds: { sw: [number, number]; ne: [number, number] } | null;
  selected: CoverageFeature | null;
  onSelect: (feature: CoverageFeature | null) => void;
  mapRef: React.MutableRefObject<unknown>;
};

function HexMapRenderer({ data, bounds, selected, onSelect, mapRef }: HexMapRendererProps) {
  const [Components, setComponents] = useState<{
    Map: React.ComponentType<Record<string, unknown>>;
    Source: React.ComponentType<Record<string, unknown>>;
    Layer: React.ComponentType<Record<string, unknown>>;
    Popup: React.ComponentType<Record<string, unknown>>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMap() {
      try {
        const pkg = 'react-map-gl/mapbox';
        const mod = await import(/* @vite-ignore */ pkg);
        if (!cancelled) {
          setComponents({
            Map: mod.default as React.ComponentType<Record<string, unknown>>,
            Source: mod.Source as React.ComponentType<Record<string, unknown>>,
            Layer: mod.Layer as React.ComponentType<Record<string, unknown>>,
            Popup: mod.Popup as React.ComponentType<Record<string, unknown>>,
          });
        }
      } catch {
        // Package not available — already handled by parent
      }
    }
    loadMap();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Components) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading map components...</p>
      </div>
    );
  }

  const { Map, Source, Layer, Popup } = Components;

  const initialViewState = bounds
    ? {
        longitude: (bounds.sw[0] + bounds.ne[0]) / 2,
        latitude: (bounds.sw[1] + bounds.ne[1]) / 2,
        zoom: 10,
      }
    : NIGERIA_CENTER;

  return (
    <Map
      ref={(ref: unknown) => {
        mapRef.current = ref;
      }}
      initialViewState={initialViewState}
      style={{ width: '100%', height: '100%' }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
      interactiveLayerIds={['coverage-hex-fill']}
      onClick={(e: { features?: Array<{ properties?: { h3Index?: string } }> }) => {
        const h3Index = e.features?.[0]?.properties?.h3Index;
        const match = h3Index
          ? (data.features.find((f) => f.properties.h3Index === h3Index) ?? null)
          : null;
        onSelect(match);
      }}
    >
      <Source id="coverage-hexes" type="geojson" data={data}>
        <Layer
          id="coverage-hex-fill"
          type="fill"
          paint={{
            'fill-color': [
              'match',
              ['get', 'type'],
              'covered',
              HEX_COLORS.covered,
              'gap',
              HEX_COLORS.gap,
              'active',
              HEX_COLORS.active,
              '#9ca3af',
            ],
            'fill-opacity': 0.55,
          }}
        />
        <Layer
          id="coverage-hex-outline"
          type="line"
          paint={{ 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.6 }}
        />
      </Source>

      {selected && (
        <Popup
          longitude={selected.properties.center.lng}
          latitude={selected.properties.center.lat}
          anchor="bottom"
          onClose={() => onSelect(null)}
          closeOnClick={false}
        >
          <div className="min-w-[160px] p-1">
            <p className="font-mono text-xs text-muted-foreground">
              {selected.properties.h3Index}
            </p>
            <div className="mt-1 space-y-0.5 text-xs">
              <p>
                <span className="font-medium">Carrier parks:</span>{' '}
                {selected.properties.parkCount}
              </p>
              <p>
                <span className="font-medium">Active drivers:</span>{' '}
                {selected.properties.driverCount}
              </p>
              <p>
                <span className="font-medium">Unmet demand:</span>{' '}
                {selected.properties.demandCount}
              </p>
            </div>
          </div>
        </Popup>
      )}
    </Map>
  );
}
