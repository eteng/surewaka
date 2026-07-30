const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_BASE_URL) {
  throw new Error('EXPO_PUBLIC_API_URL must be set');
}

/** App identifier sent to API for context-aware operations (e.g., role assignment). */
const APP_SOURCE = process.env.EXPO_PUBLIC_APP_SOURCE ?? 'unknown';

/** Default request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  /** Override default timeout (ms). Set to 0 for no timeout. */
  timeout?: number;
};

export type ErrorCategory = 'network' | 'timeout' | 'auth' | 'validation' | 'not_found' | 'server' | 'unknown';

export type ApiError = {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
};

export type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
  meta?: Record<string, unknown>;
};

/**
 * Classify an HTTP status code into an error category.
 */
function classifyHttpError(status: number, code: string): ApiError {
  if (status === 401 || status === 403) {
    return { code, message: '', category: 'auth', retryable: false };
  }
  if (status === 404) {
    return { code, message: '', category: 'not_found', retryable: false };
  }
  if (status === 400 || status === 422) {
    return { code, message: '', category: 'validation', retryable: false };
  }
  if (status >= 500) {
    return { code, message: '', category: 'server', retryable: true };
  }
  return { code, message: '', category: 'unknown', retryable: false };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token, timeout = REQUEST_TIMEOUT_MS } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Source': APP_SOURCE,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Timeout via AbortController
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeout > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const json = await response.json().catch(() => ({ error: null, meta: null })) as {
        error?: { code: string; message: string } | null;
        meta?: { eta?: string | null } | null;
      };
      const serverError = json.error || { code: 'UNKNOWN', message: 'Request failed' };
      const classified = classifyHttpError(response.status, serverError.code);
      classified.message = serverError.message;

      // Detect maintenance mode
      if (response.status === 503 && serverError.code === 'MAINTENANCE') {
        signalMaintenance(serverError.message, json.meta?.eta ?? null);
        return { data: null, error: classified };
      }

      // 5xx signals backend issues
      if (response.status >= 500) {
        signalFailure();
      }

      return { data: null, error: classified };
    }

    // Signal success to connectivity store only on 2xx
    signalSuccess();

    const json = (await response.json()) as ApiResponse<T>;
    return json;
  } catch (error: unknown) {
    if (timeoutId) clearTimeout(timeoutId);

    // Determine if this was a timeout or network failure
    const isAbort = error instanceof Error && error.name === 'AbortError';
    const category: ErrorCategory = isAbort ? 'timeout' : 'network';

    // Signal failure to connectivity store
    signalFailure();

    return {
      data: null,
      error: {
        code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: isAbort ? `Request timed out after ${timeout}ms` : 'Network error',
        category,
        retryable: true,
      },
    };
  }
}

// --- Connectivity store bridge ---
// Lazy signal functions to avoid circular dependency with the store module.
// The store is only imported when the first API call resolves.

let _storeRef: typeof import('../store/connectivity-store').useConnectivityStore | null = null;

function getStore() {
  if (!_storeRef) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _storeRef = require('../store/connectivity-store').useConnectivityStore;
  }
  return _storeRef!;
}

function signalSuccess() {
  try {
    getStore().getState().recordApiSuccess();
  } catch {
    // Store not available — ignore (e.g., during testing)
  }
}

function signalFailure() {
  try {
    getStore().getState().recordApiFailure();
  } catch {
    // Store not available — ignore
  }
}

function signalMaintenance(message: string, eta: string | null) {
  try {
    getStore().getState().setMaintenance({ message, eta });
  } catch {
    // Store not available — ignore
  }
}

export const apiClient = {
  get: <T>(path: string, token?: string) => request<T>(path, { token }),
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'POST', body, token }),
  put: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PUT', body, token }),
  patch: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PATCH', body, token }),
  delete: <T>(path: string, token?: string) => request<T>(path, { method: 'DELETE', token }),
};

export function createAuthClient(token: string) {
  return {
    get: <T>(path: string) => request<T>(path, { token }),
    post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body, token }),
    put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body, token }),
    patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body, token }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE', token }),
  };
}
