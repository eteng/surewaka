import { MapPin, Navigation, Truck } from 'lucide-react';

type DetailMapProps = {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  driverLat?: number | null;
  driverLng?: number | null;
  hasDriver: boolean;
};

/**
 * Detail map for a single delivery route.
 *
 * Displays:
 * - Pickup marker (green #16a34a)
 * - Dropoff marker (red #dc2626)
 * - GeoJSON LineString route line between pickup and dropoff
 * - Driver marker (blue #2563eb) when driver is assigned and coordinates available
 * - Auto-fits bounds to show full route
 * - Animates driver marker position changes (300ms ease-in-out CSS transition)
 *
 * Currently renders a placeholder with route visualization and coordinates.
 * When react-map-gl is installed, replace the body with full Mapbox GL integration:
 *   pnpm --filter @surewaka/admin add react-map-gl mapbox-gl
 *   pnpm --filter @surewaka/admin add -D @types/mapbox-gl
 *
 * Mapbox token: import.meta.env.VITE_MAPBOX_TOKEN
 * Map style: mapbox://styles/mapbox/streets-v12 (good coverage for Nigeria)
 */
export function DetailMap({
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  driverLat,
  driverLng,
  hasDriver,
}: DetailMapProps) {
  const showDriver = hasDriver && driverLat != null && driverLng != null;

  // Calculate rough distance for display
  const distKm = haversineDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);

  return (
    <div className="relative flex h-72 flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
      {/* Background grid pattern to suggest a map */}
      <div className="absolute inset-0 opacity-[0.07]">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="detail-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#detail-map-grid)" />
        </svg>
      </div>

      {/* Route visualization */}
      <div className="relative z-10 flex items-center gap-4">
        {/* Pickup marker (green) */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm" style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}>
            <MapPin className="h-5 w-5" />
          </div>
          <span className="text-xs font-medium" style={{ color: '#16a34a' }}>
            Pickup
          </span>
        </div>

        {/* Route line with driver */}
        <div className="relative flex items-center">
          <div className="h-0.5 w-24 border-t-2 border-dashed border-muted-foreground/40" />
          {showDriver && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ transition: 'transform 300ms ease-in-out' }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md ring-2 ring-offset-1"
                style={{ backgroundColor: '#2563eb' }} data-ring-color="#93c5fd"
              >
                <Truck className="h-4 w-4" />
              </div>
            </div>
          )}
        </div>

        {/* Dropoff marker (red) */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
            <Navigation className="h-5 w-5" />
          </div>
          <span className="text-xs font-medium" style={{ color: '#dc2626' }}>
            Dropoff
          </span>
        </div>
      </div>

      {/* Coordinates and distance */}
      <div className="relative z-10 mt-5 space-y-2 text-center">
        <div className="flex items-center justify-center gap-5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />
            {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#dc2626' }} />
            {dropoffLat.toFixed(4)}, {dropoffLng.toFixed(4)}
          </span>
        </div>

        {showDriver && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#2563eb' }} />
            Driver: {driverLat!.toFixed(4)}, {driverLng!.toFixed(4)}
          </div>
        )}

        {distKm > 0 && (
          <p className="text-xs text-muted-foreground/80">
            ~{distKm.toFixed(1)} km straight-line distance
          </p>
        )}
      </div>

      {/* Install hint */}
      <p className="relative z-10 mt-3 rounded-sm bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground/60">
        Install react-map-gl for interactive Mapbox map
      </p>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 flex gap-3 rounded-md bg-background/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#16a34a' }} />
          Pickup
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#dc2626' }} />
          Dropoff
        </span>
        {hasDriver && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#2563eb' }} />
            Driver
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Haversine formula to calculate straight-line distance between two points.
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
