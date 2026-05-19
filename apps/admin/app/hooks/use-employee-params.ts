import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  search: '',
  sortBy: 'createdAt',
  sortDir: 'desc' as const,
};

type EmployeeParams = {
  page: number;
  pageSize: number;
  search: string;
  role: string | undefined;
  status: string | undefined;
  sortBy: string;
  sortDir: 'asc' | 'desc';
};

type UseEmployeeParamsResult = {
  params: EmployeeParams;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSearch: (term: string) => void;
  setRole: (role: string | undefined) => void;
  setStatus: (status: string | undefined) => void;
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

export function useEmployeeParams(): UseEmployeeParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const params: EmployeeParams = useMemo(() => ({
    page: parseNumber(searchParams.get('page'), DEFAULTS.page),
    pageSize: parseNumber(searchParams.get('pageSize'), DEFAULTS.pageSize),
    search: searchParams.get('search') ?? DEFAULTS.search,
    role: searchParams.get('role') || undefined,
    status: searchParams.get('status') || undefined,
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

  const setRole = useCallback((role: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!role) {
        next.delete('role');
      } else {
        next.set('role', role);
      }
      // Reset page to 1
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  const setStatus = useCallback((status: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!status) {
        next.delete('status');
      } else {
        next.set('status', status);
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
    setRole,
    setStatus,
    setSortBy,
    setSortDir,
    toggleSort,
  };
}
