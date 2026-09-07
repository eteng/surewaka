// Task 1 — Bug-condition EXPLORATION tests for app/booking/pickup.tsx (LOAD paths).
//
// **EXPECTED TO FAIL on the current, unfixed screen.** Each test drives a bug
// input (isBugCondition = true) from the design's "Exploratory Bug Condition
// Checking" section and asserts the MISSING correct behaviour. On unfixed code
// there is no loading affordance, no inline error/Retry, and no Sentry reporting —
// so these assertions fail, which CONFIRMS the load-path defects. Do NOT fix the
// test or the code here.
//
// This file covers the LOAD paths (list/listRecent: in-flight, error, rejection,
// retry). The two async event-handler interactions (save-nudge create failure and
// the upsertRecent confirm rejection) each live in their own file because
// test-renderer@1.x + React 19.2 does not fully reset its reconciler between such
// async-interaction renders within a single file (see test/helpers.ts):
//   - booking-pickup.save-nudge-failure.test.tsx (Req 2.5)
//   - booking-pickup.confirm-upsert.test.tsx      (Req 2.6)
//
// These same tests become the fix-checking tests (task 5) once they pass.
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
  makeRecentLocation,
  deferred,
  type MockAddressesClient,
} from '../test/booking-address-helpers';

// --- @rnmapbox/maps: the screen calls Mapbox.setAccessToken at module load and
//     renders MapView/Camera/PointAnnotation. Stub them as inert host components. ---
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

// --- expo-location: deny permission so the on-mount device-location effect
//     resolves immediately and flips the full-screen `loading` gate to false
//     WITHOUT needing reverseGeocode — keeping the screen's initial render simple
//     and unrelated to the address-client bug inputs under test. ---
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 6.5244, longitude: 3.3792 },
  })),
}));

// --- @surewaka/mobile-shared: keep the REAL booking store + geocode helpers, but
//     replace createAddressesClient with a per-test controllable mock. ---
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

/** Render + let the token effect + on-mount loads settle. */
async function renderPickup() {
  await render(<PickupScreen />);
  // Flush the getToken().then(setToken) + subsequent list/listRecent effects.
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

describe('booking/pickup.tsx — bug-condition exploration (EXPECTED TO FAIL on unfixed code)', () => {
  // Req 2.1 — list() in flight → a loading affordance must show in the saved-address region.
  it('shows a loading affordance while the saved-address load is in flight (Req 2.1)', async () => {
    const listPending = deferred<ReturnType<typeof okEnvelope>>();
    mockClient.list.mockImplementationOnce(() => listPending.promise);
    mockClient.listRecent.mockImplementationOnce(() => deferred().promise);

    await renderPickup();

    // Unfixed: nothing renders for the in-flight load — no skeleton/loading text.
    await waitFor(() => {
      expect(screen.getByTestId('saved-addresses-loading')).toBeOnTheScreen();
    });

    await act(async () => {
      listPending.resolve(okEnvelope([]));
    });
  });

  // Req 2.2 — list() resolves { data: null, error } → inline error + Retry + one Sentry capture.
  it('shows an inline error + Retry and reports Sentry when the saved-address load fails (Req 2.2)', async () => {
    mockClient.list.mockResolvedValueOnce(errEnvelope('SERVER_ERROR', 'list failed'));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderPickup();

    expect(await screen.findByText("Couldn't load your addresses")).toBeOnTheScreen();
    expect(screen.getByText('Retry')).toBeOnTheScreen();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
  });

  // Req 2.3 / 2.4 — listRecent() rejects → Recent-section error + Retry + Sentry.
  it('shows an error + Retry and reports Sentry when the recent-locations load rejects (Req 2.3, 2.4)', async () => {
    mockClient.list.mockResolvedValueOnce(okEnvelope([]));
    mockClient.listRecent.mockRejectedValueOnce(new Error('recent boom'));

    await renderPickup();

    expect(await screen.findByText("Couldn't load your addresses")).toBeOnTheScreen();
    expect(screen.getByText('Retry')).toBeOnTheScreen();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
  });

  // Req 2.7 — after a failed load, tapping Retry (which succeeds) clears the error and renders data.
  it('clears the error and renders data when Retry succeeds after a failed load (Req 2.7)', async () => {
    mockClient.list.mockResolvedValueOnce(errEnvelope('SERVER_ERROR', 'boom'));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderPickup();

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
