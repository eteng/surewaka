import { create } from 'zustand';

/**
 * Connectivity store — tracks device-level and backend-level reachability.
 *
 * Three failure modes:
 * 1. `offline` — device has no internet (NetInfo isInternetReachable === false)
 * 2. `degraded` — internet works but backend API is unreachable (DNS, 5xx, timeout)
 * 3. `maintenance` — backend is deliberately down for scheduled maintenance
 *
 * The derived `status` drives the ConnectivityBanner and MaintenanceScreen UI.
 *
 * Recovery: When backend is marked unreachable or in maintenance, a health-check
 * poller starts (exponential backoff: 3s → 6s → 12s → 30s cap). On success,
 * it marks backend reachable and stops polling.
 */

export type ConnectivityStatus = 'online' | 'offline' | 'degraded' | 'maintenance';

export type MaintenanceInfo = {
  message: string;
  eta: string | null;
};

type ConnectivityState = {
  /** Device-level internet reachability (from NetInfo). null = not yet determined. */
  isInternetReachable: boolean | null;

  /** Whether the backend API is responding successfully. */
  isBackendReachable: boolean;

  /** Number of consecutive API failures (resets on success). */
  consecutiveFailures: number;

  /** Derived connectivity status for UI consumption. */
  status: ConnectivityStatus;

  /** Maintenance details (set when health returns maintenance status). */
  maintenance: MaintenanceInfo | null;

  /** Update internet reachability (called by NetInfo listener). */
  setInternetReachable: (reachable: boolean | null) => void;

  /** Record a successful API call (resets failure count, marks backend reachable). */
  recordApiSuccess: () => void;

  /** Record a failed API call. After threshold, marks backend as unreachable. */
  recordApiFailure: () => void;

  /** Manually mark backend as reachable (e.g., after health check succeeds). */
  setBackendReachable: (reachable: boolean) => void;

  /** Set maintenance mode (called when health endpoint returns maintenance status). */
  setMaintenance: (info: MaintenanceInfo) => void;

  /** Clear maintenance mode. */
  clearMaintenance: () => void;
};

/** Number of consecutive failures before marking backend as unreachable. */
const FAILURE_THRESHOLD = 2;

/** Health check polling config. */
const HEALTH_INITIAL_DELAY_MS = 3_000;
const HEALTH_MAX_DELAY_MS = 30_000;
const HEALTH_BACKOFF_FACTOR = 2;

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

function deriveStatus(
  isInternetReachable: boolean | null,
  isBackendReachable: boolean,
  maintenance: MaintenanceInfo | null,
): ConnectivityStatus {
  if (isInternetReachable === false) return 'offline';
  if (maintenance) return 'maintenance';
  if (isInternetReachable === true && !isBackendReachable) return 'degraded';
  return 'online';
}

// --- Health check poller (module-level, singleton) ---
let healthTimer: ReturnType<typeof setTimeout> | null = null;
let healthDelay = HEALTH_INITIAL_DELAY_MS;

function stopHealthPoller() {
  if (healthTimer) {
    clearTimeout(healthTimer);
    healthTimer = null;
  }
  healthDelay = HEALTH_INITIAL_DELAY_MS;
}

function startHealthPoller() {
  // Don't start if already running
  if (healthTimer) return;

  function poll() {
    const state = useConnectivityStore.getState();

    // Stop if backend is already back and not in maintenance, or device is offline
    if ((state.isBackendReachable && !state.maintenance) || state.isInternetReachable === false) {
      stopHealthPoller();
      return;
    }

    fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
    })
      .then(async (res) => {
        if (res.ok) {
          // Backend is back — clear any maintenance state
          useConnectivityStore.getState().clearMaintenance();
          useConnectivityStore.getState().recordApiSuccess();
          stopHealthPoller();
        } else if (res.status === 503) {
          // Check if it's maintenance
          try {
            const body = await res.json() as { status?: string; message?: string; eta?: string | null };
            if (body.status === 'maintenance') {
              useConnectivityStore.getState().setMaintenance({
                message: body.message || 'Scheduled maintenance in progress.',
                eta: body.eta || null,
              });
            }
          } catch {
            // Non-JSON 503 — treat as regular degraded
          }
          scheduleNext();
        } else {
          scheduleNext();
        }
      })
      .catch(() => {
        scheduleNext();
      });
  }

  function scheduleNext() {
    healthDelay = Math.min(healthDelay * HEALTH_BACKOFF_FACTOR, HEALTH_MAX_DELAY_MS);
    healthTimer = setTimeout(poll, healthDelay);
  }

  // Start first poll after initial delay
  healthTimer = setTimeout(poll, healthDelay);
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isInternetReachable: null,
  isBackendReachable: true,
  consecutiveFailures: 0,
  status: 'online',
  maintenance: null,

  setInternetReachable: (reachable) => {
    const { isBackendReachable, maintenance } = get();
    set({
      isInternetReachable: reachable,
      status: deriveStatus(reachable, isBackendReachable, maintenance),
    });

    // If internet just came back and backend was down, start polling
    if (reachable === true && (!isBackendReachable || maintenance)) {
      startHealthPoller();
    }
    // If internet gone, stop polling (pointless to poll without internet)
    if (reachable === false) {
      stopHealthPoller();
    }
  },

  recordApiSuccess: () => {
    const { isInternetReachable } = get();
    set({
      isBackendReachable: true,
      consecutiveFailures: 0,
      maintenance: null,
      status: deriveStatus(isInternetReachable, true, null),
    });
    stopHealthPoller();
  },

  recordApiFailure: () => {
    const { consecutiveFailures, isInternetReachable, maintenance } = get();
    const newCount = consecutiveFailures + 1;
    const backendDown = newCount >= FAILURE_THRESHOLD;
    set({
      consecutiveFailures: newCount,
      isBackendReachable: !backendDown,
      status: deriveStatus(isInternetReachable, !backendDown, maintenance),
    });

    // Start health polling once threshold is crossed
    if (backendDown && isInternetReachable !== false) {
      startHealthPoller();
    }
  },

  setBackendReachable: (reachable) => {
    const { isInternetReachable, maintenance } = get();
    set({
      isBackendReachable: reachable,
      consecutiveFailures: reachable ? 0 : get().consecutiveFailures,
      status: deriveStatus(isInternetReachable, reachable, maintenance),
    });
    if (reachable && !maintenance) {
      stopHealthPoller();
    } else if (isInternetReachable !== false) {
      startHealthPoller();
    }
  },

  setMaintenance: (info) => {
    const { isInternetReachable, isBackendReachable } = get();
    set({
      maintenance: info,
      status: deriveStatus(isInternetReachable, isBackendReachable, info),
    });
  },

  clearMaintenance: () => {
    const { isInternetReachable, isBackendReachable } = get();
    set({
      maintenance: null,
      status: deriveStatus(isInternetReachable, isBackendReachable, null),
    });
  },
}));
