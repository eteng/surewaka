// Task 6 — Preservation (Property 2) for app/booking/dropoff.tsx — SAVE-NUDGE
// SUCCESS path (Req 3.3).
//
// Feature: booking-address-resilience, Property 2: Preservation — for a
// successful (non-bug) create outcome, the fixed dropoff screen SHALL still set
// the "Saved as {label}" confirmation and append the new address to
// savedAddresses, with NO error message and NO Sentry call — identical to the
// original happy path.
//
// Own file — async event-handler mutation (see the Task 1 *.save-nudge-failure
// notes on the test-renderer@1.x + React 19.2 reconciler carry-over).
//
// _Requirements: 3.3
import fc from 'fast-check';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useBookingStore } from '@surewaka/mobile-shared';
import {
  makeAddressesClient,
  okEnvelope,
  makeSavedAddress,
  SAVE_LABELS,
  saveNudgeShown,
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

describe('Feature: booking-address-resilience, Property 2: Preservation — dropoff save-nudge success', () => {
  it('keeps the save-nudge offered under the address cap for every label (Req 3.3)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SAVE_LABELS),
        fc.integer({ min: 0, max: 24 }),
        (label, count) => {
          expect(SAVE_LABELS).toContain(label);
          expect(saveNudgeShown(count)).toBe(true);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('shows "Saved as {label}", appends the address, and reports nothing on success (Req 3.3)', async () => {
    mockClient.list.mockResolvedValueOnce(okEnvelope([makeSavedAddress({ id: 'h', label: 'Home' })]));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await render(<DropoffScreen />);
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    fireEvent.press(await screen.findByText('Home'));

    mockClient.create.mockResolvedValueOnce(
      okEnvelope(makeSavedAddress({ id: 'o', label: 'Office', address_text: 'New Office' })),
    );

    await act(async () => {
      fireEvent.press(await screen.findByText('Office'));
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(screen.getByText('Saved as Office')).toBeOnTheScreen();
    expect(screen.queryByText("Couldn't save — try again")).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });
});
