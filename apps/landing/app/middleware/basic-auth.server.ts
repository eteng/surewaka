/**
 * Basic authentication middleware for pre-launch access protection.
 * Controlled via environment variables:
 * - BASIC_AUTH_ENABLED: set to "true" to enable
 * - BASIC_AUTH_USER: expected username
 * - BASIC_AUTH_PASSWORD: expected password
 */

/**
 * Checks HTTP Basic Authentication on the incoming request.
 * Returns null if auth passes or is disabled.
 * Returns a 401 Response with WWW-Authenticate header if auth fails.
 */
export function requireBasicAuth(request: Request): Response | null {
  const enabled = process.env.BASIC_AUTH_ENABLED;

  if (enabled !== 'true') {
    return null;
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return unauthorizedResponse();
  }

  const encoded = authHeader.slice('Basic '.length);
  let decoded: string;

  try {
    decoded = atob(encoded);
  } catch {
    return unauthorizedResponse();
  }

  const separatorIndex = decoded.indexOf(':');

  if (separatorIndex === -1) {
    return unauthorizedResponse();
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  const expectedUser = process.env.BASIC_AUTH_USER ?? '';
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD ?? '';

  if (username !== expectedUser || password !== expectedPassword) {
    return unauthorizedResponse();
  }

  return null;
}

function unauthorizedResponse(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="SureWaka"',
    },
  });
}
