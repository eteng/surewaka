import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, MapPin, X } from 'lucide-react';
import type { DeliveryListItem } from '@surewaka/shared';
import 'mapbox-gl/dist/mapbox-gl.css';

// ─── Types ─────────────────────────────────────────────────────────────────────

type DeliveryMapProps = {
  data: DeliveryListItem[];
  isLoading: boolean;
  highlightedDeliveryId?: string | null;
};

type MarkerData = {
  id: string;
  deliveryId: string;
  type: 'pickup' | 'dropoff';
  lat: number;
  lng: number;
  customerName: string;
  status: string;
  address: string;
};

type PopupData = MarkerData | null;

type ViewState = {
  latitude: number;
  longitude: number;
  zoom: number;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const MARKER_COLORS = {
  pickup: '#16a34a',
  dropoff: '#dc2626',
} as const;

const NIGERIA_CENTER: ViewState = {
  latitude: 9.0,
  longitude: 7.5,
  zoom: 5,
};

const NIGERIA_BOUNDS = {
  lat: { min: 4.0, max: 14.0 },
  lng: { min: 2.5, max: 14.5 },
} as const;

const FIT_BOUNDS_DURATION = 500;

// ─── Coordinate Validation ─────────────────────────────────────────────────────

function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  return (
    lat >= NIGERIA_BOUNDS.lat.min &&
    lat <= NIGERIA_BOUNDS.lat.max &&
    lng >= NIGERIA_BOUNDS.lng.min &&
    lng <= NIGERIA_BOUNDS.lng.max
  );
}

// ─── Marker extraction from delivery data ──────────────────────────────────────

type DeliveryWithCoords = DeliveryListItem & {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
};

function extractMarkers(data: DeliveryListItem[]): {
  markers: MarkerData[];
  unavailableCount: number;
} {
  const markers: MarkerData[] = [];
  let unavailableCount = 0;

  for (const delivery of data as DeliveryWithCoords[]) {
    const pickupLat = delivery.pickupLat ?? null;
    const pickupLng = delivery.pickupLng ?? null;
    const dropoffLat = delivery.dropoffLat ?? null;
    const dropoffLng = delivery.dropoffLng ?? null;

    let hasUnavailable = false;

    if (isValidCoordinate(pickupLat, pickupLng)) {
      markers.push({
        id: `${delivery.id}-pickup`,
        deliveryId: delivery.id,
        type: 'pickup',
        lat: pickupLat!,
        lng: pickupLng!,
        customerName: delivery.customerName,
        status: delivery.status,
        address: delivery.pickupAddress,
      });
    } else {
      hasUnavailable = true;
    }

    if (isValidCoordinate(dropoffLat, dropoffLng)) {
      markers.push({
        id: `${delivery.id}-dropoff`,
        deliveryId: delivery.id,
        type: 'dropoff',
        lat: dropoffLat!,
        lng: dropoffLng!,
        customerName: delivery.customerName,
        status: delivery.status,
        address: delivery.dropoffAddress,
      });
    } else {
      hasUnavailable = true;
    }

    if (hasUnavailable) {
      unavailableCount++;
    }
  }

  return { markers, unavailableCount };
}

// ─── Bounds calculation ────────────────────────────────────────────────────────

function calculateBounds(markers: MarkerData[]): {
  sw: [number, number];
  ne: [number, number];
} | null {
  if (markers.length === 0) return null;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const marker of markers) {
    if (marker.lng < minLng) minLng = marker.lng;
    if (marker.lng > maxLng) maxLng = marker.lng;
    if (marker.lat < minLat) minLat = marker.lat;
    if (marker.lat > maxLat) maxLat = marker.lat;
  }

  const padding = 0.02;
  return {
    sw: [minLng - padding, minLat - padding],
    ne: [maxLng + padding, maxLat + padding],
  };
}

// ─── Status badge helper ───────────────────────────────────────────────────────

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function DeliveryMap({ data, isLoading, highlightedDeliveryId }: DeliveryMapProps) {
  const [popup, setPopup] = useState<PopupData>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapAvailable, setMapAvailable] = useState<boolean | null>(null);
  const mapRef = useRef<unknown>(null);
  const fitBoundsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if react-map-gl is available
  useEffect(() => {
    let cancelled = false;
    async function checkMapAvailability() {
      try {
        // Dynamic import with variable to prevent bundler resolution errors
        const pkg = 'react-map-gl';
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

  // Extract markers and compute unavailable count
  const { markers, unavailableCount } = useMemo(() => extractMarkers(data), [data]);

  // Calculate viewport bounds
  const bounds = useMemo(() => calculateBounds(markers), [markers]);

  // Auto-fit bounds when data changes
  useEffect(() => {
    if (!mapReady || !mapRef.current || !bounds) return;

    if (fitBoundsTimeoutRef.current) {
      clearTimeout(fitBoundsTimeoutRef.current);
    }

    fitBoundsTimeoutRef.current = setTimeout(() => {
      const map = mapRef.current as { fitBounds?: (bounds: unknown, options: unknown) => void };
      if (map?.fitBounds) {
        map.fitBounds([bounds.sw, bounds.ne], {
          padding: 50,
          duration: FIT_BOUNDS_DURATION,
        });
      }
    }, 100);

    return () => {
      if (fitBoundsTimeoutRef.current) {
        clearTimeout(fitBoundsTimeoutRef.current);
      }
    };
  }, [bounds, mapReady]);

  // Handle marker click
  const handleMarkerClick = useCallback((marker: MarkerData) => {
    setPopup(marker);
  }, []);

  // Dismiss popup
  const handlePopupClose = useCallback(() => {
    setPopup(null);
  }, []);

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="relative flex h-96 items-center justify-center rounded-lg border bg-muted/30">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }

  // ─── Package not available fallback ────────────────────────────────────────

  if (mapAvailable === false) {
    return (
      <div className="relative flex h-96 flex-col rounded-lg border bg-muted/10">
        {/* Legend */}
        <MapLegend />

        {/* Unavailable coordinates info bar */}
        {unavailableCount > 0 && <UnavailableBar count={unavailableCount} />}

        {/* Placeholder map area */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
          <MapPin className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">
            Map view requires react-map-gl package
          </p>
          <p className="max-w-sm text-center text-xs text-muted-foreground/70">
            Install <code className="rounded bg-muted px-1 py-0.5">react-map-gl</code> and{' '}
            <code className="rounded bg-muted px-1 py-0.5">mapbox-gl</code> to enable interactive
            map visualization with pickup and dropoff markers.
          </p>
          {markers.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {markers.length} markers ready to display from {data.length} deliveries
            </p>
          )}
        </div>

        {/* Delivery markers list (non-map fallback view) */}
        {markers.length > 0 && (
          <div className="border-t px-4 py-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Delivery Locations ({markers.length} markers)
            </p>
            <div className="flex flex-wrap gap-2">
              {markers.slice(0, 10).map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted ${
                    highlightedDeliveryId === marker.deliveryId
                      ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                      : ''
                  }`}
                  onClick={() => handleMarkerClick(marker)}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: MARKER_COLORS[marker.type] }}
                  />
                  <span className="truncate" style={{ maxWidth: '120px' }}>
                    {marker.address}
                  </span>
                </button>
              ))}
              {markers.length > 10 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  +{markers.length - 10} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Popup overlay */}
        {popup && (
          <MarkerPopup popup={popup} onClose={handlePopupClose} />
        )}
      </div>
    );
  }

  // ─── Package check still loading ──────────────────────────────────────────

  if (mapAvailable === null) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border bg-muted/30">
        <p className="text-sm text-muted-foreground">Initializing map...</p>
      </div>
    );
  }

  // ─── No valid coordinates ──────────────────────────────────────────────────

  if (markers.length === 0) {
    return (
      <div className="relative flex h-96 flex-col rounded-lg border bg-muted/10">
        <MapLegend />
        {unavailableCount > 0 && <UnavailableBar count={unavailableCount} />}
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <MapPin className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No locations available to display
          </p>
          <p className="text-xs text-muted-foreground/70">
            Deliveries in the current view don&apos;t have valid coordinate data.
          </p>
        </div>
      </div>
    );
  }

  // ─── Map with react-map-gl (dynamic import) ───────────────────────────────

  return (
    <div className="relative h-96 overflow-hidden rounded-lg border">
      <MapLegend />
      {unavailableCount > 0 && <UnavailableBar count={unavailableCount} />}
      <MapRenderer
        markers={markers}
        bounds={bounds}
        popup={popup}
        highlightedDeliveryId={highlightedDeliveryId}
        onMarkerClick={handleMarkerClick}
        onPopupClose={handlePopupClose}
        onMapReady={() => setMapReady(true)}
        mapRef={mapRef}
      />
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MapLegend() {
  return (
    <div className="absolute left-3 top-3 z-10 rounded-md border bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: MARKER_COLORS.pickup }}
          />
          <span className="text-xs text-foreground">Pickup</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: MARKER_COLORS.dropoff }}
          />
          <span className="text-xs text-foreground">Dropoff</span>
        </div>
      </div>
    </div>
  );
}

function UnavailableBar({ count }: { count: number }) {
  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
      <Info className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">
        {count} {count === 1 ? 'delivery' : 'deliveries'} with unavailable coordinates
      </span>
    </div>
  );
}

function MarkerPopup({ popup, onClose }: { popup: MarkerData; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/10">
      <div className="w-72 rounded-lg border bg-white p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">{popup.customerName}</h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-0.5 hover:bg-muted"
            aria-label="Close popup"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: MARKER_COLORS[popup.type] }}
            />
            <span className="text-xs capitalize text-muted-foreground">
              {popup.type} location
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Status:</span> {formatStatus(popup.status)}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Address:</span> {popup.address}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Dynamic Map Renderer (uses react-map-gl when available) ───────────────────

type MapRendererProps = {
  markers: MarkerData[];
  bounds: { sw: [number, number]; ne: [number, number] } | null;
  popup: PopupData;
  highlightedDeliveryId?: string | null;
  onMarkerClick: (marker: MarkerData) => void;
  onPopupClose: () => void;
  onMapReady: () => void;
  mapRef: React.MutableRefObject<unknown>;
};

function MapRenderer({
  markers,
  bounds,
  popup,
  highlightedDeliveryId,
  onMarkerClick,
  onPopupClose,
  onMapReady,
  mapRef,
}: MapRendererProps) {
  const [MapComponents, setMapComponents] = useState<{
    Map: React.ComponentType<Record<string, unknown>>;
    Marker: React.ComponentType<Record<string, unknown>>;
    Popup: React.ComponentType<Record<string, unknown>>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMap() {
      try {
        const pkg = 'react-map-gl';
        const reactMapGl = await import(/* @vite-ignore */ pkg);
        if (!cancelled) {
          setMapComponents({
            Map: reactMapGl.Map as unknown as React.ComponentType<Record<string, unknown>>,
            Marker: reactMapGl.Marker as unknown as React.ComponentType<Record<string, unknown>>,
            Popup: reactMapGl.Popup as unknown as React.ComponentType<Record<string, unknown>>,
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

  if (!MapComponents) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading map components...</p>
      </div>
    );
  }

  const { Map, Marker, Popup: PopupComponent } = MapComponents;

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
        if (ref) onMapReady();
      }}
      initialViewState={initialViewState}
      style={{ width: '100%', height: '100%' }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
    >
      {markers.map((marker) => {
        const isHighlighted = highlightedDeliveryId === marker.deliveryId;
        const size = isHighlighted ? 16 : 10;
        const ringSize = isHighlighted ? 22 : 0;

        return (
          <Marker
            key={marker.id}
            longitude={marker.lng}
            latitude={marker.lat}
            anchor="center"
            onClick={(e: { originalEvent?: { stopPropagation?: () => void } }) => {
              e?.originalEvent?.stopPropagation?.();
              onMarkerClick(marker);
            }}
          >
            <div
              className="cursor-pointer transition-all duration-200"
              style={{ position: 'relative' }}
            >
              {isHighlighted && (
                <span
                  className="absolute animate-ping rounded-full"
                  style={{
                    width: ringSize,
                    height: ringSize,
                    top: -(ringSize - size) / 2,
                    left: -(ringSize - size) / 2,
                    backgroundColor: MARKER_COLORS[marker.type],
                    opacity: 0.3,
                  }}
                />
              )}
              <span
                className="block rounded-full border-2 border-white shadow-md transition-all duration-200"
                style={{
                  width: size,
                  height: size,
                  backgroundColor: MARKER_COLORS[marker.type],
                  boxShadow: isHighlighted
                    ? `0 0 0 3px ${MARKER_COLORS[marker.type]}40`
                    : undefined,
                }}
              />
            </div>
          </Marker>
        );
      })}

      {popup && (
        <PopupComponent
          longitude={popup.lng}
          latitude={popup.lat}
          anchor="bottom"
          onClose={onPopupClose}
          closeOnClick={false}
        >
          <div className="min-w-[180px] p-1">
            <h4 className="text-sm font-medium">{popup.customerName}</h4>
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Status:</span> {formatStatus(popup.status)}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Address:</span> {popup.address}
              </p>
            </div>
          </div>
        </PopupComponent>
      )}
    </Map>
  );
}
