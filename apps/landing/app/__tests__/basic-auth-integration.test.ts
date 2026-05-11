// Feature: surewaka-landing-page
// Integration test: Basic auth middleware scenario-based tests
// Validates: Requirements 13.1, 13.2, 13.4

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireBasicAuth } from '../middleware/basic-auth.server';

describe('Basic Auth Middleware — Integration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createRequest(authHeader: string | null): Request {
    const headers = new Headers();
    if (authHeader !== null) {
      headers.set('Authorization', authHeader);
    }
    return new Request('http://localhost/', { headers });
  }

  function encodeCredentials(username: string, password: string): string {
    return btoa(`${username}:${password}`);
  }

  describe('BASIC_AUTH_ENABLED=true and no credentials', () => {
    it('returns 401 with WWW-Authenticate: Basic header', () => {
      process.env.BASIC_AUTH_ENABLED = 'true';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const request = createRequest(null);
      const result = requireBasicAuth(request);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
    });
  });

  describe('BASIC_AUTH_ENABLED=true and correct credentials', () => {
    it('returns null (allows request through)', () => {
      process.env.BASIC_AUTH_ENABLED = 'true';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const encoded = encodeCredentials('admin', 'secret');
      const request = createRequest(`Basic ${encoded}`);
      const result = requireBasicAuth(request);

      expect(result).toBeNull();
    });
  });

  describe('BASIC_AUTH_ENABLED=true and wrong credentials', () => {
    it('returns 401 when username is wrong', () => {
      process.env.BASIC_AUTH_ENABLED = 'true';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const encoded = encodeCredentials('wronguser', 'secret');
      const request = createRequest(`Basic ${encoded}`);
      const result = requireBasicAuth(request);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
    });

    it('returns 401 when password is wrong', () => {
      process.env.BASIC_AUTH_ENABLED = 'true';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const encoded = encodeCredentials('admin', 'wrongpass');
      const request = createRequest(`Basic ${encoded}`);
      const result = requireBasicAuth(request);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
    });

    it('returns 401 when both username and password are wrong', () => {
      process.env.BASIC_AUTH_ENABLED = 'true';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const encoded = encodeCredentials('hacker', 'letmein');
      const request = createRequest(`Basic ${encoded}`);
      const result = requireBasicAuth(request);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(result!.headers.get('WWW-Authenticate')).toBe('Basic realm="SureWaka"');
    });
  });

  describe('BASIC_AUTH_ENABLED=false', () => {
    it('returns null regardless of missing credentials', () => {
      process.env.BASIC_AUTH_ENABLED = 'false';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const request = createRequest(null);
      const result = requireBasicAuth(request);

      expect(result).toBeNull();
    });

    it('returns null regardless of wrong credentials', () => {
      process.env.BASIC_AUTH_ENABLED = 'false';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const encoded = encodeCredentials('wrong', 'wrong');
      const request = createRequest(`Basic ${encoded}`);
      const result = requireBasicAuth(request);

      expect(result).toBeNull();
    });
  });

  describe('BASIC_AUTH_ENABLED is not set', () => {
    it('returns null (publicly accessible) when env var is undefined', () => {
      delete process.env.BASIC_AUTH_ENABLED;
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const request = createRequest(null);
      const result = requireBasicAuth(request);

      expect(result).toBeNull();
    });

    it('returns null (publicly accessible) when env var is empty string', () => {
      process.env.BASIC_AUTH_ENABLED = '';
      process.env.BASIC_AUTH_USER = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';

      const request = createRequest(null);
      const result = requireBasicAuth(request);

      expect(result).toBeNull();
    });
  });
});
