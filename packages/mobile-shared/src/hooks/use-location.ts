import { useState, useEffect } from 'react';

type LocationCoords = {
  latitude: number;
  longitude: number;
};

type LocationState = {
  coords: LocationCoords | null;
  loading: boolean;
  error: string | null;
  requestPermission: () => Promise<boolean>;
};

export function useLocation(): LocationState {
  const [coords, setCoords] = useState<LocationCoords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPermission = async (): Promise<boolean> => {
    // TODO: Implement expo-location permission request
    // This will be different for customer (foreground only) vs driver (background)
    return false;
  };

  return { coords, loading, error, requestPermission };
}
