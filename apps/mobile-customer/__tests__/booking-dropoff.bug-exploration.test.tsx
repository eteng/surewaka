// Task 1 — Bug-condition EXPLORATION tests for app/booking/dropoff.tsx (LOAD paths).
//
// Symmetric to booking-pickup.bug-exploration.test.tsx. **EXPECTED TO FAIL on
// the current, unfixed screen** — the same load-path defects exist identically on
// dropoff (route 'booking/dropoff', navigation to /booking/package). This file
// covers the LOAD paths (list/listRecent: in-flight, error, rejection, retry).
// The two async event-handler interactions are isolated in their own files:
//   - booking-dropoff.save-nudge-failure.test.tsx (Req 2.5)
//   - booking-dropoff.confirm-upsert.test.tsx      (Req 2.6)
// Do NOT fix the test or the code here; the failure confirms the bug.
//
// _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useBookingStore } from '@surewaka/mobile-shared';
import {
  makeAddressesClient,
  okEnvelope,
  errEnvelope,
  makeSavedAddress,
  deferred,
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

async function renderDropoff() {
  await render(<DropoffScreen />);
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  mockClient = makeAddressesClient();
  useBookingStore.getState().reset();
  (global as any).__resetRouterMock();
  captureException.mockClear();
});
afterEach(async () => {
  await cleanup();
});

describe('booking/dropoff.tsx — bug-condition exploration (EXPECTED TO FAIL on unfixed code)', () => {
  // Req 2.1
  it('shows a loading affordance while the saved-address load is in flight (Req 2.1)', async () => {
    mockClient.list.mockImplementationOnce(() => deferred().promise);
    mockClient.listRecent.mockImplementationOnce(() => deferred().promise);

    await renderDropoff();

    await waitFor(() => {
      expect(screen.getByTestId('saved-addresses-loading')).toBeOnTheScreen();
    });
  });

  // Req 2.2
  it('shows an inline error + Retry and reports Sentry when the saved-address load fails (Req 2.2)', async () => {
    mockClient.list.mockResolvedValueOnce(errEnvelope('SERVER_ERROR', 'list failed'));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderDropoff();

    expect(await screen.findByText("Couldn't load your addresses")).toBeOnTheScreen();
    expect(screen.getByText('Retry')).toBeOnTheScreen();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
  });

  // Req 2.3 / 2.4
  it('shows an error + Retry and reports Sentry when the recent-locations load rejects (Req 2.3, 2.4)', async () => {
    mockClient.list.mockResolvedValueOnce(okEnvelope([]));
    mockClient.listRecent.mockRejectedValueOnce(new Error('recent boom'));

    await renderDropoff();

    expect(await screen.findByText("Couldn't load your addresses")).toBeOnTheScreen();
    expect(screen.getByText('Retry')).toBeOnTheScreen();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
  });

  // Req 2.7
  it('clears the error and renders data when Retry succeeds after a failed load (Req 2.7)', async () => {
    mockClient.list.mockResolvedValueOnce(errEnvelope('SERVER_ERROR', 'boom'));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderDropoff();

    const retry = await screen.findByText('Retry');

    mockClient.list.mockResolvedValueOnce(okEnvelope([makeSavedAddress({ label: 'Retried' })]));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await act(async () => {
      fireEvent.press(retry);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(screen.queryByText("Couldn't load your addresses")).toBeNull();
    expect(await screen.findByText('Retried')).toBeOnTheScreen();
  });
});
