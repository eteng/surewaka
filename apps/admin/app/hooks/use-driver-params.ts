import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  search: '',
  sortBy: 'createdAt',
  sortDir: 'desc' as const,
};

export type DriverParams = {
  page: number;
  pageSize: number;
  search: string;
  vehicleType: string | undefined;
  verified: string | undefined;
  available: string | undefined;
  carrierId: string | undefined;
  affiliation: string | undefined;
  sortBy: string;
  sortDir: 'asc' | 'desc';
};

type UseDriverParamsResult = {
  params: DriverParams;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (term: string) => void;
  setVehicleType: (type: string | undefined) => void;
  setVerified: (verified: string | undefined) => void;
  setAvailable: (available: string | undefined) => void;
  setCarrierId: (id: string | undefined) => void;
  setAffiliation: (affiliation: string | undefined) => void;
  toggleSort: (column: string) => void;
};

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseSortDir(value: string | null): 'asc' | 'desc' {
  if (value === 'asc' || value === 'desc') return value;
  return DEFAULTS.sortDir;
}

export function useDriverParams(): UseDriverParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const params: DriverParams = useMemo(
    () => ({
      page: parseNumber(searchParams.get('page'), DEFAULTS.page),
      pageSize: parseNumber(searchParams.get('pageSize'), DEFAULTS.pageSize),
      search: searchParams.get('search') ?? DEFAULTS.search,
      vehicleType: searchParams.get('vehicleType') || undefined,
      verified: searchParams.get('verified') || undefined,
      available: searchParams.get('available') || undefined,
      carrierId: searchParams.get('carrierId') || undefined,
      affiliation: searchParams.get('affiliation') || undefined,
      sortBy: searchParams.get('sortBy') || DEFAULTS.sortBy,
      sortDir: parseSortDir(searchParams.get('sortDir')),
    }),
    [searchParams],
  );

  const setPage = useCallback(
    (page: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (page <= 1) next.delete('page');
        else next.set('page', String(page));
        return next;
      });
    },
    [setSearchParams],
  );

  const setPageSize = useCallback(
    (size: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (size === DEFAULTS.pageSize) next.delete('pageSize');
        else next.set('pageSize', String(size));
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setSearch = useCallback(
    (term: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (term === '') next.delete('search');
        else next.set('search', term);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setVehicleType = useCallback(
    (type: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!type) next.delete('vehicleType');
        else next.set('vehicleType', type);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setVerified = useCallback(
    (verified: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!verified) next.delete('verified');
        else next.set('verified', verified);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setAvailable = useCallback(
    (available: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!available) next.delete('available');
        else next.set('available', available);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setCarrierId = useCallback(
    (id: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!id) next.delete('carrierId');
        else next.set('carrierId', id);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setAffiliation = useCallback(
    (affiliation: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!affiliation) next.delete('affiliation');
        else next.set('affiliation', affiliation);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const toggleSort = useCallback(
    (column: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const currentSortBy = prev.get('sortBy') || DEFAULTS.sortBy;
        const currentSortDir = parseSortDir(prev.get('sortDir'));

        if (currentSortBy === column) {
          const newDir = currentSortDir === 'desc' ? 'asc' : 'desc';
          if (newDir === DEFAULTS.sortDir) next.delete('sortDir');
          else next.set('sortDir', newDir);
        } else {
          if (column === DEFAULTS.sortBy) next.delete('sortBy');
          else next.set('sortBy', column);
          if (DEFAULTS.sortDir === 'desc') next.delete('sortDir');
          else next.set('sortDir', 'desc');
        }
        return next;
      });
    },
    [setSearchParams],
  );

  return {
    params,
    setPage,
    setPageSize,
    setSearch,
    setVehicleType,
    setVerified,
    setAvailable,
    setCarrierId,
    setAffiliation,
    toggleSort,
  };
}
