import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  search: '',
  sortBy: 'createdAt',
  sortDir: 'desc' as const,
};

export type CustomerParams = {
  page: number;
  pageSize: number;
  search: string;
  tier: string | undefined;
  verified: string | undefined;
  city: string | undefined;
  joinedFrom: string | undefined;
  joinedTo: string | undefined;
  sortBy: string;
  sortDir: 'asc' | 'desc';
};

type UseCustomerParamsResult = {
  params: CustomerParams;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (term: string) => void;
  setTier: (tier: string | undefined) => void;
  setVerified: (verified: string | undefined) => void;
  setCity: (city: string | undefined) => void;
  setJoinedFrom: (date: string | undefined) => void;
  setJoinedTo: (date: string | undefined) => void;
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

export function useCustomerParams(): UseCustomerParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const params: CustomerParams = useMemo(
    () => ({
      page: parseNumber(searchParams.get('page'), DEFAULTS.page),
      pageSize: parseNumber(searchParams.get('pageSize'), DEFAULTS.pageSize),
      search: searchParams.get('search') ?? DEFAULTS.search,
      tier: searchParams.get('tier') || undefined,
      verified: searchParams.get('verified') || undefined,
      city: searchParams.get('city') || undefined,
      joinedFrom: searchParams.get('joinedFrom') || undefined,
      joinedTo: searchParams.get('joinedTo') || undefined,
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

  const setTier = useCallback(
    (tier: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!tier) next.delete('tier');
        else next.set('tier', tier);
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

  const setCity = useCallback(
    (city: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!city) next.delete('city');
        else next.set('city', city);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setJoinedFrom = useCallback(
    (date: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!date) next.delete('joinedFrom');
        else next.set('joinedFrom', date);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const setJoinedTo = useCallback(
    (date: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!date) next.delete('joinedTo');
        else next.set('joinedTo', date);
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
    setTier,
    setVerified,
    setCity,
    setJoinedFrom,
    setJoinedTo,
    toggleSort,
  };
}
