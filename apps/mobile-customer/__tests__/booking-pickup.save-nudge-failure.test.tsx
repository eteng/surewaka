// Task 1 — Bug-condition EXPLORATION test for app/booking/pickup.tsx
// (SAVE-NUDGE failure path, Req 2.5).
//
// **EXPECTED TO FAIL on the current, unfixed screen.** When a user taps a
// save-nudge label and client.create(...) resolves { error }, the current screen
// does nothing — no visible message, no Sentry report. This test asserts the
// missing feedback + report, so it fails on unfixed code (confirming the defect).
//
// Own file — the async event handler (setState after `await client.create()`)
// carries reconciler state under test-renderer@1.x + React 19.2, so this
// mutation-style interaction is isolated (see test/helpers.ts). Do NOT fix here.
//
// _Requirements: 2.5
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useBookingStore } from '@surewaka/mobile-shared';
import {
  makeAddressesClient,
  okEnvelope,
  errEnvelope,
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

it('shows a visible failure message and reports Sentry when a save-nudge create fails (Req 2.5)', async () => {
  mockClient.list.mockResolvedValueOnce(okEnvelope([makeSavedAddress({ label: 'Home' })]));
  mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

  await render(<PickupScreen />);
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  // Tap the saved-address chip to select a location (populates selectedAddress),
  // which reveals the save-nudge pills.
  fireEvent.press(await screen.findByText('Home'));

  // create() will fail; tapping "Office" must surface a message + report.
  mockClient.create.mockResolvedValueOnce(errEnvelope('SERVER_ERROR', 'create failed'));

  await act(async () => {
    fireEvent.press(await screen.findByText('Office'));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  expect(screen.getByText("Couldn't save — try again")).toBeOnTheScreen();
  expect(captureException).toHaveBeenCalledTimes(1);
  expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
});
