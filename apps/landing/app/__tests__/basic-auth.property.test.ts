// Feature: surewaka-landing-page
// Property 4: Basic auth middleware correctly gates access
// Validates: Requirements 13.1, 13.2, 13.4

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { requireBasicAuth } from '../middleware/basic-auth.server';

describe('Basic Auth Middleware — Property Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Helper: encode credentials as Base64 for the Authorization header.
   */
  function encodeCredentials(username: string, password: string): string {
    return btoa(`${username}:${password}`);
  }

  /**
   * Helper: create a Request with an optional Authorization header.
   */
  function createRequest(authHeader: string | null): Request {
    const headers = new Headers();
    if (authHeader !== null) {
      headers.set('Authorization', authHeader);
    }
    return new Request('http://localhost/', { headers });
  }

  // Property 4: Basic auth middleware correctly gates access
  // For any HTTP request, WHEN BASIC_AUTH_ENABLED is "true", the middleware SHALL
  // return a 401 response if and only if the request does not contain valid credentials.
  // WHEN BASIC_AUTH_ENABLED is not "true", the middleware SHALL allow all requests through.
  describe('Property 4: Basic auth middleware correctly gates access', () => {
    // Arbitrary for non-empty username/password strings (printable ASCII, no colons in username)
    const usernameArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => !s.includes(':') && s.trim().length > 0);

    const passwordArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

    // Arbitrary for the enabled flag
    const enabledArb = fc.boolean();

    it('returns null (allows through) when auth is disabled, regardless of credentials', () => {
      fc.assert(
        fc.property(
          usernameArb,
          passwordArb,
          fc.option(fc.string(), { nil: undefined }),
          (configUser, configPassword, requestCredentials) => {
            // Auth disabled
            process.env.BASIC_AUTH_ENABLED = 'false';
            process.env.BASIC_AUTH_USER = configUser;
            process.env.BASIC_AUTH_PASSWORD = configPassword;

            let authHeader: string | null = null;
            if (requestCredentials !== undefined) {
              authHeader = `Basic ${btoa(requestCredentials)}`;
            }

            const request = createRequest(authHeader);
            const result = requireBasicAuth(request);

            // Should always allow through when disabled
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns null when auth is enabled and correct credentials are provided', () => {
      fc.assert(
        fc.property(usernameArb, passwordArb, (configUser, configPassword) => {
          process.env.BASIC_AUTH_ENABLED = 'true';
          process.env.BASIC_AUTH_USER = configUser;
          process.env.BASIC_AUTH_PASSWORD = configPassword;

          const encoded = encodeCredentials(configUser, configPassword);
          const request = createRequest(`Basic ${encoded}`);
          const result = requireBasicAuth(request);

          // Should allow through with correct credentials
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('returns 401 when auth is enabled and no credentials are provided', () => {
      fc.assert(
        fc.property(usernameArb, passwordArb, (configUser, configPassword) => {
          process.env.BASIC_AUTH_ENABLED = 'true';
          process.env.BASIC_AUTH_USER = configUser;
          process.env.BASIC_AUTH_PASSWORD = configPassword;

          const request = createRequest(null);
          const result = requireBasicAuth(request);

          // Should return 401
          expect(result).not.toBeNull();
          expect(result!.status).toBe(401);
          expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
        }),
        { numRuns: 100 },
      );
    });

    it('returns 401 when auth is enabled and wrong credentials are provided', () => {
      fc.assert(
        fc.property(
          usernameArb,
          passwordArb,
          usernameArb,
          passwordArb,
          (configUser, configPassword, requestUser, requestPassword) => {
            // Ensure credentials don't accidentally match
            fc.pre(requestUser !== configUser || requestPassword !== configPassword);

            process.env.BASIC_AUTH_ENABLED = 'true';
            process.env.BASIC_AUTH_USER = configUser;
            process.env.BASIC_AUTH_PASSWORD = configPassword;

            const encoded = encodeCredentials(requestUser, requestPassword);
            const request = createRequest(`Basic ${encoded}`);
            const result = requireBasicAuth(request);

            // Should return 401 with wrong credentials
            expect(result).not.toBeNull();
            expect(result!.status).toBe(401);
            expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('correctly gates access for any combination of enabled state and credentials', () => {
      fc.assert(
        fc.property(
          enabledArb,
          usernameArb,
          passwordArb,
          fc.option(
            fc.record({
              username: usernameArb,
              password: passwordArb,
            }),
            { nil: undefined },
          ),
          (enabled, configUser, configPassword, requestCreds) => {
            process.env.BASIC_AUTH_ENABLED = enabled ? 'true' : 'false';
            process.env.BASIC_AUTH_USER = configUser;
            process.env.BASIC_AUTH_PASSWORD = configPassword;

            let authHeader: string | null = null;
            if (requestCreds !== undefined) {
              authHeader = `Basic ${encodeCredentials(requestCreds.username, requestCreds.password)}`;
            }

            const request = createRequest(authHeader);
            const result = requireBasicAuth(request);

            if (!enabled) {
              // When disabled, always allow through
              expect(result).toBeNull();
            } else if (
              requestCreds !== undefined &&
              requestCreds.username === configUser &&
              requestCreds.password === configPassword
            ) {
              // When enabled with correct credentials, allow through
              expect(result).toBeNull();
            } else {
              // When enabled with missing or wrong credentials, return 401
              expect(result).not.toBeNull();
              expect(result!.status).toBe(401);
              expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 401 when auth is enabled and Authorization header is not Basic scheme', () => {
      fc.assert(
        fc.property(
          usernameArb,
          passwordArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          (configUser, configPassword, token) => {
            process.env.BASIC_AUTH_ENABLED = 'true';
            process.env.BASIC_AUTH_USER = configUser;
            process.env.BASIC_AUTH_PASSWORD = configPassword;

            // Use Bearer or other non-Basic scheme
            const request = createRequest(`Bearer ${token}`);
            const result = requireBasicAuth(request);

            expect(result).not.toBeNull();
            expect(result!.status).toBe(401);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
