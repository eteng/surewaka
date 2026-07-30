import { useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { useConnectivityStore } from '../store/connectivity-store';

/**
 * Hook that subscribes to NetInfo and writes device-level reachability
 * into the connectivity store. Pauses/resumes on AppState changes
 * to conserve battery when the app is backgrounded.
 *
 * Usage: Call once near the root of the app (e.g., in _layout.tsx).
 */
export function useNetInfoListener(): void {
  const setInternetReachable = useConnectivityStore((s) => s.setInternetReachable);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Subscribe to NetInfo state changes
    function subscribe() {
      unsubscribeRef.current = NetInfo.addEventListener((state) => {
        // Only react to definitive values — null means "not yet determined"
        if (state.isInternetReachable !== null) {
          setInternetReachable(state.isInternetReachable);
        }
      });
    }

    // Initial subscription
    subscribe();

    // Also do an immediate fetch to avoid waiting for the first event
    NetInfo.fetch().then((state) => {
      if (state.isInternetReachable !== null) {
        setInternetReachable(state.isInternetReachable);
      }
    });

    // Pause/resume based on app state to save battery
    function handleAppState(nextState: AppStateStatus) {
      if (nextState === 'active') {
        // Re-subscribe and immediately check
        if (!unsubscribeRef.current) {
          subscribe();
        }
        NetInfo.refresh();
      } else if (nextState === 'background') {
        // Unsubscribe while backgrounded
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      }
    }

    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      appStateSub.remove();
    };
  }, [setInternetReachable]);
}
