// Task 1 — Bug-condition EXPLORATION test for app/booking/dropoff.tsx
// (SAVE-NUDGE failure path, Req 2.5). Symmetric to
// booking-pickup.save-nudge-failure.test.tsx.
//
// **EXPECTED TO FAIL on the current, unfixed screen** — a failed save-nudge
// create gives no feedback and no Sentry report. Own file (see the note in the
// pickup counterpart). Do NOT fix here.
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

it('shows a visible failure message and reports Sentry when a save-nudge create fails (Req 2.5)', async () => {
  mockClient.list.mockResolvedValueOnce(okEnvelope([makeSavedAddress({ label: 'Home' })]));
  mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

  await render(<DropoffScreen />);
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  fireEvent.press(await screen.findByText('Home'));

  mockClient.create.mockResolvedValueOnce(errEnvelope('SERVER_ERROR', 'create failed'));

  await act(async () => {
    fireEvent.press(await screen.findByText('Office'));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

  expect(screen.getByText("Couldn't save — try again")).toBeOnTheScreen();
  expect(captureException).toHaveBeenCalledTimes(1);
  expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
});
