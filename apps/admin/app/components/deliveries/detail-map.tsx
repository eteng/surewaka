import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, Truck } from 'lucide-react';
import { Map, Marker, Source, Layer, type MapRef } from 'react-map-gl/mapbox';
import type { GeoJSON } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DetailMapProps = {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  driverLat?: number | null;
  driverLng?: number | null;
  hasDriver: boolean;
  pickupAddress?: string;
  dropoffAddress?: string;
};

type RouteData = {
  geojson: GeoJSON;
  distanceKm: number;
  durationMin: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PICKUP_COLOR = '#16a34a';
const DROPOFF_COLOR = '#dc2626';
const DRIVER_COLOR = '#2563eb';

const NIGERIA_BOUNDS = { lat: { min: 4.0, max: 14.0 }, lng: { min: 2.5, max: 14.5 } } as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function isValidCoord(lat: number, lng: number): boolean {
  return (
    lat >= NIGERIA_BOUNDS.lat.min && lat <= NIGERIA_BOUNDS.lat.max &&
    lng >= NIGERIA_BOUNDS.lng.min && lng <= NIGERIA_BOUNDS.lng.max
  );
}

// ─── Mapbox Directions API ────────────────────────────────────────────────────

async function fetchDrivingRoute(
  pickupLng: number, pickupLat: number,
  dropoffLng: number, dropoffLat: number,
  token: string,
  signal: AbortSignal,
): Promise<RouteData | null> {
  const coords = `${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&steps=false&access_token=${token}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) return null;
  return {
    geojson: { type: 'Feature', properties: {}, geometry: r.geometry } as GeoJSON,
    distanceKm: r.distance / 1000,
    durationMin: Math.round(r.duration / 60),
  };
}

// ─── No-token fallback ────────────────────────────────────────────────────────

function MapFallback({ pickupAddress, dropoffAddress }: { pickupAddress?: string; dropoffAddress?: string }) {
  return (
    <div className="relative h-64 overflow-hidden rounded-lg border border-dashed bg-muted/40 flex items-center justify-center">
      <div className="flex flex-col items-start gap-3 px-6 w-full max-w-xs">
        <div className="flex items-start gap-2.5">
          <div
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: '#dcfce7', color: PICKUP_COLOR }}
          >
            <MapPin className="h-3 w-3" aria-hidden="true" />
          </div>
          <span className="text-sm text-foreground leading-snug">
            {pickupAddress ?? 'Pickup location'}
          </span>
        </div>

        <div className="ml-3 h-5 border-l-2 border-dashed border-muted-foreground/30" />

        <div className="flex items-start gap-2.5">
          <div
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: '#fef2f2', color: DROPOFF_COLOR }}
          >
            <Navigation className="h-3 w-3" aria-hidden="true" />
          </div>
          <span className="text-sm text-foreground leading-snug">
            {dropoffAddress ?? 'Dropoff location'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Map renderer ─────────────────────────────────────────────────────────────

type MapRendererProps = {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  showDriver: boolean;
  driverLat?: number | null;
  driverLng?: number | null;
  route: RouteData | null;
  routeLoading: boolean;
};

function MapRenderer({
  pickupLat, pickupLng, dropoffLat, dropoffLng,
  showDriver, driverLat, driverLng,
  route, routeLoading,
}: MapRendererProps) {
  const mapRef = useRef<MapRef>(null);
  const driverFittedRef = useRef(false);
  const isDark = useIsDark();
  const mapStyle = isDark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';

  const handleLoad = useCallback(() => {
    const pad = 0.008;
    mapRef.current?.fitBounds(
      [
        [Math.min(pickupLng, dropoffLng) - pad, Math.min(pickupLat, dropoffLat) - pad],
        [Math.max(pickupLng, dropoffLng) + pad, Math.max(pickupLat, dropoffLat) + pad],
      ],
      { padding: 44, duration: 0 },
    );
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  useEffect(() => {
    if (!showDriver || driverLat == null || driverLng == null) {
      driverFittedRef.current = false;
      return;
    }
    if (!mapRef.current) return;

    if (!driverFittedRef.current) {
      driverFittedRef.current = true;
      const pad = 0.008;
      mapRef.current.fitBounds(
        [
          [Math.min(pickupLng, dropoffLng, driverLng) - pad, Math.min(pickupLat, dropoffLat, driverLat) - pad],
          [Math.max(pickupLng, dropoffLng, driverLng) + pad, Math.max(pickupLat, dropoffLat, driverLat) + pad],
        ],
        { padding: 44, duration: 600 },
      );
    } else {
      mapRef.current.easeTo({ center: [driverLng, driverLat], duration: 400 });
    }
  }, [showDriver, driverLat, driverLng, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const placeholderGeoJSON: GeoJSON = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [[pickupLng, pickupLat], [dropoffLng, dropoffLat]],
    },
  };

  return (
    <div className="relative h-64 overflow-hidden rounded-lg">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: (pickupLng + dropoffLng) / 2,
          latitude: (pickupLat + dropoffLat) / 2,
          zoom: 11,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
        onLoad={handleLoad}
        attributionControl={false}
      >
        {!route && (
          <Source id="route-placeholder" type="geojson" data={placeholderGeoJSON}>
            <Layer
              id="route-placeholder-line"
              type="line"
              paint={{ 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [4, 3] }}
            />
          </Source>
        )}

        {route && (
          <Source id="route-real" type="geojson" data={route.geojson}>
            <Layer
              id="route-real-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 }}
            />
            <Layer
              id="route-real-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': PICKUP_COLOR, 'line-width': 3.5 }}
            />
          </Source>
        )}

        <Marker longitude={pickupLng} latitude={pickupLat} anchor="bottom">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full shadow-md"
            style={{ backgroundColor: '#dcfce7', color: PICKUP_COLOR }}
            aria-label="Pickup"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
          </div>
        </Marker>

        <Marker longitude={dropoffLng} latitude={dropoffLat} anchor="bottom">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full shadow-md"
            style={{ backgroundColor: '#fef2f2', color: DROPOFF_COLOR }}
            aria-label="Dropoff"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
          </div>
        </Marker>

        {showDriver && driverLat != null && driverLng != null && (
          <Marker longitude={driverLng} latitude={driverLat} anchor="center">
            <div className="relative flex h-8 w-8 items-center justify-center" aria-label="Driver">
              <span
                className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full opacity-40"
                style={{ backgroundColor: DRIVER_COLOR }}
              />
              <div
                className="relative flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md ring-2 ring-white"
                style={{ backgroundColor: DRIVER_COLOR }}
              >
                <Truck className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
          </Marker>
        )}
      </Map>

      {route && (
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm">
          <span className="font-medium text-foreground">{route.distanceKm.toFixed(1)} km</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">~{route.durationMin} min</span>
        </div>
      )}

      {routeLoading && !route && (
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm text-muted-foreground">
          <span className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none rounded-full border border-muted-foreground border-t-transparent" />
          Route…
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function DetailMap({
  pickupLat, pickupLng, dropoffLat, dropoffLng,
  driverLat, driverLng, hasDriver,
  pickupAddress, dropoffAddress,
}: DetailMapProps) {
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setRouteLoading(true);
    setRoute(null);

    fetchDrivingRoute(pickupLng, pickupLat, dropoffLng, dropoffLat, token, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setRoute(data); })
      .catch(() => { /* dashed placeholder stays visible on error */ })
      .finally(() => { if (!controller.signal.aborted) setRouteLoading(false); });

    return () => controller.abort();
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, token]);

  const showDriver =
    hasDriver && driverLat != null && driverLng != null && isValidCoord(driverLat, driverLng);

  if (!token) {
    return <MapFallback pickupAddress={pickupAddress} dropoffAddress={dropoffAddress} />;
  }

  return (
    <MapRenderer
      pickupLat={pickupLat} pickupLng={pickupLng}
      dropoffLat={dropoffLat} dropoffLng={dropoffLng}
      showDriver={showDriver} driverLat={driverLat} driverLng={driverLng}
      route={route} routeLoading={routeLoading}
    />
  );
}
