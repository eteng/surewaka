import { useState, useEffect, useCallback } from 'react';
import * as Sentry from '@sentry/react-native';
import type { SavedAddress, RecentLocation } from '@surewaka/shared';
// Import the addresses-client factory through the package's public surface (via a
// thin re-export module) rather than the concrete `./addresses` implementation.
// This is the single seam that the mobile-customer jest suite controls: the app's
// `jest.mock('@surewaka/mobile-shared', ...)` re-exports this module through the
// test shim, so the tests' `createAddressesClient` override reaches THIS hook and
// the real Promise.all / Sentry / state logic runs against the mocked client. In
// production it simply re-exports the real `createAddressesClient` from `./addresses`.
import { createAddressesClient } from '../api/addresses-client';

export type AddrLoadState = 'loading' | 'error' | 'ready';

type UseSavedAddressesResult = {
  /** Saved addresses loaded via `client.list()`. */
  savedAddresses: SavedAddress[];
  /** Recent locations loaded via `client.listRecent()`. */
  recentLocations: RecentLocation[];
  /** Combined load state: 'loading' until first settle, then 'ready' or 'error'. */
  state: AddrLoadState;
  /** Re-runs `client.list()` + `client.listRecent()`; used on mount and by Retry. */
  reload: () => void;
  /** Appends a newly created address (used by the save-nudge success branch). */
  addSaved: (addr: SavedAddress) => void;
};

/**
 * Shared hook that owns the saved-address / recent-location load resilience for the
 * booking pickup and dropoff screens.
 *
 * `reload()` runs `client.list()` and `client.listRecent()` together via `Promise.all`.
 * If either result carries a non-null `error`, or the combined promise rejects, the hook
 * enters the `'error'` state and reports the failure to Sentry exactly once (tagged
 * `app:mobile-customer`, with route + op context and no PII). On success it populates both
 * arrays and enters the `'ready'` state.
 *
 * The load is keyed on `token` and gated on a non-empty `token`, preserving the screens'
 * existing `if (!token) return;` timing.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 3.1, 3.2
 */
export function useSavedAddresses(token: string, route: string): UseSavedAddressesResult {
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
  const [state, setState] = useState<AddrLoadState>('loading');

  const reload = useCallback(() => {
    if (!token) return;
    const client = createAddressesClient(token);
    setState('loading');

    Promise.all([client.list(), client.listRecent()])
      .then(([savedResult, recentResult]) => {
        if (savedResult.error || recentResult.error) {
          const failure = savedResult.error ?? recentResult.error;
          setState('error');
          Sentry.captureException(
            failure instanceof Error ? failure : new Error(JSON.stringify(failure)),
            { tags: { app: 'mobile-customer' }, extra: { route, op: 'load' } },
          );
          return;
        }
        setSavedAddresses(savedResult.data ?? []);
        setRecentLocations(recentResult.data ?? []);
        setState('ready');
      })
      .catch((e: unknown) => {
        setState('error');
        Sentry.captureException(e instanceof Error ? e : new Error(JSON.stringify(e)), {
          tags: { app: 'mobile-customer' },
          extra: { route, op: 'load' },
        });
      });
  }, [token, route]);

  useEffect(() => {
    if (!token) return;
    reload();
  }, [token, reload]);

  const addSaved = useCallback((addr: SavedAddress) => {
    setSavedAddresses((prev) => [...prev, addr]);
  }, []);

  return { savedAddresses, recentLocations, state, reload, addSaved };
}
