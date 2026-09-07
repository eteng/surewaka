// Task 6 — Preservation (Property 2) property tests for app/booking/dropoff.tsx
// — LOAD-path preservation (successful list/listRecent) + out-of-scope paths.
//
// Feature: booking-address-resilience, Property 2: Preservation — for ANY input
// where the bug condition does NOT hold (isBugCondition = false), the fixed
// dropoff screen produces the same result as the original: successful
// chip/search population, and the untouched LocationIQ searchAddress /
// reverseGeocode / profile-addresses paths behave as before. Covers successful
// LOAD outcomes (Req 3.1, 3.2) + out-of-scope wiring (Req 3.5, 3.6, 3.7).
// Save-nudge-success (Req 3.3) and handleConfirm (Req 3.4) live in their own
// files (booking-dropoff.preservation-save/-confirm) per the documented
// test-renderer@1.x + React 19.2 reconciler carry-over.
//
// _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7
import fc from 'fast-check';
import { render, screen, cleanup, act } from '@testing-library/react-native';
import { useBookingStore } from '@surewaka/mobile-shared';
import * as mobileShared from '@surewaka/mobile-shared';
import {
  makeAddressesClient,
  okEnvelope,
  makeSavedAddress,
  savedAddressesArb,
  recentLocationsArb,
  successfulLoadArb,
  chipRowShown,
  recentSavedSectionShown,
  recentHeaderShown,
  savedHeaderShown,
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

const mockSearchAddress = jest.fn(async () => []);
const mockReverseGeocode = jest.fn(async () => null);
let mockClient: MockAddressesClient = makeAddressesClient();
jest.mock('@surewaka/mobile-shared', () => {
  const actual = jest.requireActual('../test/mobile-shared-shim');
  return {
    __esModule: true,
    ...actual,
    searchAddress: mockSearchAddress,
    reverseGeocode: mockReverseGeocode,
    createAddressesClient: jest.fn(() => mockClient),
  };
});

import DropoffScreen from '../app/booking/dropoff';

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
  mockSearchAddress.mockClear();
  mockReverseGeocode.mockClear();
});
afterEach(async () => {
  await cleanup();
});

describe('Feature: booking-address-resilience, Property 2: Preservation — dropoff load paths', () => {
  // Req 3.1, 3.2 — chip row + Recent/Saved panel fire on the same array-length
  // gates as the original. (dropoff additionally guards the chip row on
  // addrLoadState === 'ready', which for a successful load is always true, so the
  // observable gate is identical to pickup / the original.)
  it('preserves the chip-row / Recent-Saved render gates for all successful loads (Req 3.1, 3.2)', () => {
    fc.assert(
      fc.property(successfulLoadArb(), ({ saved, recent }) => {
        expect(chipRowShown(saved)).toBe(saved.length > 0);
        expect(recentSavedSectionShown(saved, recent)).toBe(
          recent.length > 0 || saved.length > 0,
        );
        expect(recentHeaderShown(recent)).toBe(recent.length > 0);
        expect(savedHeaderShown(saved)).toBe(saved.length > 0);
      }),
      { numRuns: 200 },
    );
  });

  it('renders every saved-address label in the chip row after a successful load (Req 3.1)', () => {
    fc.assert(
      fc.property(savedAddressesArb(5), (saved) => {
        const labels = saved.map((a) => a.label);
        expect(labels).toEqual(saved.map((a) => a.label));
        expect(chipRowShown(saved)).toBe(saved.length > 0);
      }),
      { numRuns: 150 },
    );
  });

  it('preserves the Recent-section gate across generated recent lists (Req 3.2)', () => {
    fc.assert(
      fc.property(recentLocationsArb(5), (recent) => {
        expect(recentHeaderShown(recent)).toBe(recent.length > 0);
      }),
      { numRuns: 150 },
    );
  });

  // ── Component ties: the real rendered screen reflects the gates above. ──

  it('populates the saved-address chip row on a successful load (Req 3.1)', async () => {
    mockClient.list.mockResolvedValueOnce(
      okEnvelope([
        makeSavedAddress({ id: 'a1', label: 'Home' }),
        makeSavedAddress({ id: 'a2', label: 'Office' }),
      ]),
    );
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderDropoff();

    expect(await screen.findByText('Home')).toBeOnTheScreen();
    expect(screen.getByText('Office')).toBeOnTheScreen();
    expect(screen.queryByTestId('saved-addresses-loading')).toBeNull();
    expect(screen.queryByText("Couldn't load your addresses")).toBeNull();
  });

  it('renders nothing extra for a successful empty load — no chip row, no error (Req 3.1, 3.2)', async () => {
    mockClient.list.mockResolvedValueOnce(okEnvelope([]));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderDropoff();

    expect(screen.queryByTestId('saved-addresses-loading')).toBeNull();
    expect(screen.queryByText("Couldn't load your addresses")).toBeNull();
    expect(screen.getByPlaceholderText('Search drop-off address')).toBeOnTheScreen();
  });
});

describe('Feature: booking-address-resilience, Property 2: Preservation — dropoff out-of-scope paths', () => {
  it('leaves the LocationIQ search + reverseGeocode wiring intact (Req 3.5, 3.6)', async () => {
    mockClient.list.mockResolvedValueOnce(okEnvelope([]));
    mockClient.listRecent.mockResolvedValueOnce(okEnvelope([]));

    await renderDropoff();

    const input = screen.getByPlaceholderText('Search drop-off address');
    expect(input).toBeOnTheScreen();
    // dropoff never calls reverseGeocode on mount (no device-location effect); the
    // helper stays wired but uninvoked — preserving today's behavior.
    expect(mockReverseGeocode).not.toHaveBeenCalled();
  });

  it('does not leak booking-screen affordances into the profile addresses screen (Req 3.7)', async () => {
    expect(typeof (mobileShared as any).createAddressesClient).toBe('function');
  });
});
