import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { WaitlistQuery } from '@surewaka/shared';

const DEFAULTS: Required<Pick<WaitlistQuery, 'page' | 'pageSize' | 'search' | 'sortBy' | 'sortDir'>> = {
  page: 1,
  pageSize: 20,
  search: '',
  sortBy: 'createdAt',
  sortDir: 'desc',
};

type WaitlistParams = {
  page: number;
  pageSize: number;
  search: string;
  userType: string | undefined;
  source: string | undefined;
  sortBy: string;
  sortDir: 'asc' | 'desc';
};

type UseWaitlistParamsResult = {
  params: WaitlistParams;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (term: string) => void;
  setUserType: (type: string | undefined) => void;
  setSource: (source: string | undefined) => void;
  setSortBy: (column: string) => void;
  setSortDir: (dir: 'asc' | 'desc') => void;
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

export function useWaitlistParams(): UseWaitlistParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const params: WaitlistParams = useMemo(() => ({
    page: parseNumber(searchParams.get('page'), DEFAULTS.page),
    pageSize: parseNumber(searchParams.get('pageSize'), DEFAULTS.pageSize),
    search: searchParams.get('search') ?? DEFAULTS.search,
    userType: searchParams.get('userType') || undefined,
    source: searchParams.get('source') || undefined,
    sortBy: searchParams.get('sortBy') || DEFAULTS.sortBy,
    sortDir: parseSortDir(searchParams.get('sortDir')),
  }), [searchParams]);

  const setPage = useCallback((page: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (page <= 1) {
        next.delete('page');
      } else {
        next.set('page', String(page));
      }
      return next;
    });
  }, [setSearchParams]);

  const setPageSize = useCallback((size: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (size === DEFAULTS.pageSize) {
        next.delete('pageSize');
      } else {
        next.set('pageSize', String(size));
      }
      // Reset page to 1
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  const setSearch = useCallback((term: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (term === '') {
        next.delete('search');
      } else {
        next.set('search', term);
      }
      // Reset page to 1
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  const setUserType = useCallback((type: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!type) {
        next.delete('userType');
      } else {
        next.set('userType', type);
      }
      // Reset page to 1
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  const setSource = useCallback((source: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!source) {
        next.delete('source');
      } else {
        next.set('source', source);
      }
      // Reset page to 1
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  const setSortBy = useCallback((column: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (column === DEFAULTS.sortBy) {
        next.delete('sortBy');
      } else {
        next.set('sortBy', column);
      }
      return next;
    });
  }, [setSearchParams]);

  const setSortDir = useCallback((dir: 'asc' | 'desc') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (dir === DEFAULTS.sortDir) {
        next.delete('sortDir');
      } else {
        next.set('sortDir', dir);
      }
      return next;
    });
  }, [setSearchParams]);

  const toggleSort = useCallback((column: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentSortBy = prev.get('sortBy') || DEFAULTS.sortBy;
      const currentSortDir = parseSortDir(prev.get('sortDir'));

      if (currentSortBy === column) {
        // Same column — flip direction
        const newDir = currentSortDir === 'desc' ? 'asc' : 'desc';
        if (newDir === DEFAULTS.sortDir) {
          next.delete('sortDir');
        } else {
          next.set('sortDir', newDir);
        }
      } else {
        // Different column — set to desc
        if (column === DEFAULTS.sortBy) {
          next.delete('sortBy');
        } else {
          next.set('sortBy', column);
        }
        if (DEFAULTS.sortDir === 'desc') {
          next.delete('sortDir');
        } else {
          next.set('sortDir', 'desc');
        }
      }
      return next;
    });
  }, [setSearchParams]);

  return {
    params,
    setPage,
    setPageSize,
    setSearch,
    setUserType,
    setSource,
    setSortBy,
    setSortDir,
    toggleSort,
  };
}
