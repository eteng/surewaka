const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
};

export type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: Record<string, unknown>;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await response.json()) as ApiResponse<T>;

    if (!response.ok) {
      return { data: null, error: json.error || { code: 'UNKNOWN', message: 'Request failed' } };
    }

    return json;
  } catch {
    return { data: null, error: { code: 'NETWORK_ERROR', message: 'Network error' } };
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
