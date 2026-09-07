// Task 1 — Bug-condition EXPLORATION test for app/booking/pickup.tsx
// (CONFIRM upsertRecent rejection path, Req 2.6).
//
// **EXPECTED TO FAIL on the current, unfixed screen.** handleConfirm fires
// client.upsertRecent(...) with no .then/.catch, so a rejection becomes an
// unhandled promise rejection and nothing is reported. This test asserts the
// rejection is caught + reported to Sentry AND that router.push still fires
// synchronously (fire-and-forget preserved). On unfixed code there is no Sentry
// capture, so the assertion fails (confirming the defect). Do NOT fix here.
//
// Own file — see the note in booking-pickup.save-nudge-failure.test.tsx.
//
// _Requirements: 2.6
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useBookingStore } from '@surewaka/mobile-shared';
import {
  makeAddressesClient,
  okEnvelope,
  makeSavedAddress,
  type MockAddressesClient,
} from '../test/booking-address-helpers';

jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn(),
    MapView: 'MapView',
    Camera: 'Camera',
    PointAnnotation: 'PointAnnotation',
    StyleURL: { Street: 'street' },
  },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 6.5244, longitude: 3.3792 },
  })),
}));

let mockClient: MockAddressesClient = makeAddressesClient();
jest.mock('@surewaka/mobile-shared', () => {
  const actual = jest.requireActual('../test/mobile-shared-shim');
  return {
    __esModule: true,
    ...actual,
    searchAddress: jest.fn(async () => []),
    reverseGeocode: jest.fn(async () => null),
    createAddressesClient: jest.fn(() => mockClient),
  };
});

import PickupScreen from '../app/booking/pickup';

const captureException = Sentry.captureException as jest.Mock;

beforeEach(() => {
  mockClient = makeAddressesClient();
  useBookingStore.getState().reset();
  (global as any).__resetRouterMock();
  captureException.mockClear();
});
afterEach(async () => {
  await cleanup();
});

it('catches an upsertRecent rejection, reports Sentry, and still navigates synchronously (Req 2.6)', async () => {
  mockClient.list.mockResolvedValueOnce(okEnvelope([makeSavedAddress({ label: 'Home' })]));
  mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

  await render(<PickupScreen />);
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  // Select a location via the saved-address chip.
  fireEvent.press(await screen.findByText('Home'));

  // The background recent write will reject.
  mockClient.upsertRecent.mockRejectedValueOnce(new Error('upsert boom'));

  const router = (global as any).__expoRouterMock;

  await act(async () => {
    fireEvent.press(await screen.findByText('Confirm Pickup'));
    // Navigation must be synchronous (fire-and-forget write, not awaited).
    expect(router.push).toHaveBeenCalledWith('/booking/dropoff');
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  // The rejection must be caught and reported (unfixed: unhandled, no capture).
  expect(captureException).toHaveBeenCalledTimes(1);
  expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
});
