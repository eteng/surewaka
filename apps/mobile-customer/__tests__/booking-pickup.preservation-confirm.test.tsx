// Task 6 — Preservation (Property 2) for app/booking/pickup.tsx — handleConfirm
// happy path (Req 3.4).
//
// Feature: booking-address-resilience, Property 2: Preservation — for a valid
// selected location with a SUCCESSFUL (non-bug) upsertRecent, handleConfirm SHALL
// still: set pickup in the booking store, advance the step, fire upsertRecent as a
// non-blocking background write, and navigate synchronously — WITHOUT awaiting the
// write. This is identical to the original behavior; the fix only added a .catch
// that never runs on the success path.
//
// Own file — async event-handler interaction (see the Task 1 *.confirm-upsert
// notes on the test-renderer@1.x + React 19.2 reconciler carry-over).
//
// _Requirements: 3.4
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useBookingStore } from '@surewaka/mobile-shared';
import {
  makeAddressesClient,
  okEnvelope,
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

describe('Feature: booking-address-resilience, Property 2: Preservation — pickup handleConfirm', () => {
  it('sets pickup + step, fires a non-blocking upsertRecent, and navigates synchronously (Req 3.4)', async () => {
    mockClient.list.mockResolvedValueOnce(okEnvelope([makeSavedAddress({ id: 'h', label: 'Home' })]));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await render(<PickupScreen />);
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    // Select the saved chip -> selectedAddress/coords populated.
    fireEvent.press(await screen.findByText('Home'));

    // The background write stays IN-FLIGHT (deferred) so we can prove navigation
    // does NOT await it: router.push must fire while upsertRecent is unresolved.
    const pending = deferred<ReturnType<typeof okEnvelope>>();
    mockClient.upsertRecent.mockImplementationOnce(() => pending.promise);

    const router = (global as any).__expoRouterMock;

    await act(async () => {
      fireEvent.press(await screen.findByText('Confirm Pickup'));
      // Synchronous, non-blocking: navigation happened even though upsertRecent
      // has not resolved yet.
      expect(mockClient.upsertRecent).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith('/booking/dropoff');

      // Booking store was updated: pickup set + step advanced to 1.
      const st = useBookingStore.getState();
      expect(st.pickup).not.toBeNull();
      expect(st.pickup?.address).toBe(makeSavedAddress({ label: 'Home' }).address_text);
      expect(st.step).toBe(1);

      // Now let the background write resolve successfully — no error, no Sentry.
      pending.resolve(okEnvelope(undefined as unknown as void));
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(captureException).not.toHaveBeenCalled();
    // Navigation was called exactly once (not re-fired by the write settling).
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
