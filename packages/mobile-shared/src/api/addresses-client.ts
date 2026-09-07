// Thin re-export seam for the addresses-client factory.
//
// `use-saved-addresses.ts` imports `createAddressesClient` from HERE instead of
// directly from `./addresses` so that a single module boundary owns how the hook
// obtains its client. In production this is a transparent re-export of the real
// factory. Under the mobile-customer jest suite, the app resolves
// `@surewaka/mobile-shared` to `apps/mobile-customer/test/mobile-shared-shim.ts`,
// which mocks this module so the tests' controllable `createAddressesClient`
// reaches the real hook (keeping the hook's Promise.all / Sentry / state logic
// under test). See that shim for the mock wiring.
export { createAddressesClient } from './addresses';
