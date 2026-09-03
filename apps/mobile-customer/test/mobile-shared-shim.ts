// Slim stand-in for `@surewaka/mobile-shared` used ONLY under jest.
//
// The real barrel (packages/mobile-shared/src/index.ts) eagerly imports heavy
// native/transitive modules (ably realtime, expo-notifications, netinfo,
// @rnmapbox/maps) that are irrelevant to the three recipient screens and painful
// to load in the node/jsdom test env. The screens under test consume only:
//   - useBookingStore     (real Zustand store)
//   - useRecipientStore   (real Zustand store)
//   - createRecipientsClient (real API client)
// so we re-export exactly those from the REAL source modules. The API client's
// transport (api/client.ts) issues fetch(); tests stub global.fetch so nothing
// hits the network.
export { useBookingStore } from '@surewaka/mobile-shared/src/store/booking-store';
export { useRecipientStore } from '@surewaka/mobile-shared/src/store/recipient-store';
export { createRecipientsClient } from '@surewaka/mobile-shared/src/api/recipients';
export { apiClient, createAuthClient } from '@surewaka/mobile-shared/src/api/client';
export type { ApiResponse, ApiError } from '@surewaka/mobile-shared/src/api/client';
