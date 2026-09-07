// Task 1 — Bug-condition EXPLORATION test for app/booking/dropoff.tsx
// (CONFIRM upsertRecent rejection path, Req 2.6). Symmetric to
// booking-pickup.confirm-upsert.test.tsx.
//
// **EXPECTED TO FAIL on the current, unfixed screen** — the unhandled
// upsertRecent rejection is not caught or reported. Asserts the rejection is
// caught + reported AND router.push('/booking/package') still fires
// synchronously. Own file (see the note in the pickup counterpart). Do NOT fix here.
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

import DropoffScreen from '../app/booking/dropoff';

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

  await render(<DropoffScreen />);
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  fireEvent.press(await screen.findByText('Home'));

  mockClient.upsertRecent.mockRejectedValueOnce(new Error('upsert boom'));

  const router = (global as any).__expoRouterMock;

  await act(async () => {
    fireEvent.press(await screen.findByText('Confirm Drop-off'));
    // Navigation must be synchronous (fire-and-forget write, not awaited).
    expect(router.push).toHaveBeenCalledWith('/booking/package');
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  expect(captureException).toHaveBeenCalledTimes(1);
  expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
});
