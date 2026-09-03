// The API transport (src/api/client.ts) reads process.env.EXPO_PUBLIC_API_URL
// at module-import time and throws if it is unset. Provide a stable base URL so
// the module can be imported under test. Tests assert on the request path, not
// this host.
process.env.EXPO_PUBLIC_API_URL = 'https://api.test.local';
process.env.EXPO_PUBLIC_APP_SOURCE = 'jest';
