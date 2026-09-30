// Slim stand-in for `@surewaka/mobile-shared` used ONLY under jest.
//
// The real barrel (packages/mobile-shared/src/index.ts) eagerly imports heavy
// native/transitive modules (ably realtime, expo-notifications, netinfo,
// @rnmapbox/maps) that are irrelevant to the screens under test and painful to
// load in the node/jsdom test env. So we re-export exactly the surface the
// recipient + booking-address screens consume, straight from the REAL source
// modules:
//   - useBookingStore / useRecipientStore   (real Zustand stores)
//   - createRecipientsClient                 (real API client)
//   - useSavedAddresses                      (REAL hook — its Promise.all / Sentry /
//                                             state logic stays under test)
//   - searchAddress / reverseGeocode         (real geocode helpers)
//   - createAddressesClient                  (real factory; the booking-address
//                                             tests override this on the package mock)
// The API client's transport (api/client.ts) issues fetch(); tests stub
// global.fetch so nothing hits the network.
//
// How the booking-address tests drive the REAL `useSavedAddresses` hook with a
// mocked client: each test file does
//   jest.mock('@surewaka/mobile-shared', () => ({
//     ...jest.requireActual('../test/mobile-shared-shim'),
//     ...,
//     createAddressesClient: jest.fn(() => mockClient),
//   }))
// The hook obtains its client from `packages/mobile-shared/src/api/addresses-client.ts`.
// `jest.setup.js` mocks THAT seam module to delegate to the (mocked)
// `@surewaka/mobile-shared` export, so the test's `createAddressesClient` override
// flows into the real hook while its resilience logic runs unchanged.
export { useBookingStore } from '@surewaka/mobile-shared/src/store/booking-store';
export { useRecipientStore } from '@surewaka/mobile-shared/src/store/recipient-store';
export { createRecipientsClient } from '@surewaka/mobile-shared/src/api/recipients';
export { apiClient, createAuthClient } from '@surewaka/mobile-shared/src/api/client';
export type { ApiResponse, ApiError } from '@surewaka/mobile-shared/src/api/client';
export { useSavedAddresses } from '@surewaka/mobile-shared/src/hooks/use-saved-addresses';
export type { AddrLoadState } from '@surewaka/mobile-shared/src/hooks/use-saved-addresses';
export { useBottomActionInset } from '@surewaka/mobile-shared/src/hooks/use-bottom-action-inset';
export { createAddressesClient } from '@surewaka/mobile-shared/src/api/addresses-client';
export { searchAddress, reverseGeocode } from '@surewaka/mobile-shared/src/maps/locationiq';
export type { LocationSuggestion } from '@surewaka/mobile-shared/src/maps/locationiq';
