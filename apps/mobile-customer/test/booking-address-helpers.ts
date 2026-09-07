// Shared test helpers for the booking-address-resilience spec tests
// (app/booking/pickup.tsx and app/booking/dropoff.tsx).
//
// Unlike the recipient screens (which drive the REAL API client via a global.fetch
// stub), the booking-address tests mock `createAddressesClient` directly per the
// spec's Testing Strategy, so each `list` / `listRecent` / `create` / `upsertRecent`
// outcome (resolve `{ data, error }`, reject, or stay in-flight) is controlled
// explicitly. The mock is installed via `jest.mock('@surewaka/mobile-shared', ...)`
// in each test file; this module only builds the controllable client + fixtures.
import type { SavedAddress, RecentLocation } from '@surewaka/shared';

/** A deferred promise whose resolve/reject can be driven from the test. */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The `{ data, error }` envelope every addresses-client method returns. */
export type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };

export function okEnvelope<T>(data: T): Envelope<T> {
  return { data, error: null };
}

export function errEnvelope(code = 'SERVER_ERROR', message = 'boom'): Envelope<never> {
  return { data: null, error: { code, message } };
}

/**
 * A jest-controllable stand-in for the object returned by createAddressesClient.
 * Every method is a jest.Mock; tests set implementations/resolved values per case.
 */
export type MockAddressesClient = {
  list: jest.Mock;
  listRecent: jest.Mock;
  create: jest.Mock;
  upsertRecent: jest.Mock;
  get: jest.Mock;
  update: jest.Mock;
  remove: jest.Mock;
};

export function makeAddressesClient(): MockAddressesClient {
  return {
    list: jest.fn(async () => okEnvelope<SavedAddress[]>([])),
    listRecent: jest.fn(async () => okEnvelope<RecentLocation[]>([])),
    create: jest.fn(async () => okEnvelope<SavedAddress>(makeSavedAddress())),
    upsertRecent: jest.fn(async () => okEnvelope<void>(undefined as unknown as void)),
    get: jest.fn(async () => okEnvelope<SavedAddress>(makeSavedAddress())),
    update: jest.fn(async () => okEnvelope<SavedAddress>(makeSavedAddress())),
    remove: jest.fn(async () => okEnvelope<void>(undefined as unknown as void)),
  };
}

export function makeSavedAddress(overrides: Partial<SavedAddress> = {}): SavedAddress {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Home',
    address_text: '12 Marina Road, Lagos Island',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4541,
    lng: 3.3947,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeRecentLocation(overrides: Partial<RecentLocation> = {}): RecentLocation {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    address_text: '5 Allen Avenue, Ikeja',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.6018,
    lng: 3.3515,
    used_at: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 6 — Preservation (Property 2) fast-check arbitraries + pure predicates.
//
// APPEND-ONLY: everything below is additive. The exports above (used by the
// Task 1 exploration/fix-checking tests) are intentionally left untouched.
//
// These support the property-based preservation tests, which assert Property-2
// equivalence F(X) = F'(X) for all NON-bug inputs (isBugCondition = false), i.e.
// only successful `{ data }` load / create outcomes. Driving a real RN screen
// render 100+ times is infeasible/flaky (each async render is ~seconds and the
// documented test-renderer@1.x + React 19.2 reconciler carry-over makes repeated
// renders in one file unsafe), so — as the recipient property tests already do —
// the properties target the exact pure derivations the FIXED screens use to
// decide what renders, over generated successful datasets, and a handful of
// concrete component renders tie those derivations back to the real screens.
// ---------------------------------------------------------------------------
import fc from 'fast-check';
import type { SavedAddress, RecentLocation } from '@surewaka/shared';

export const ADDRESS_CAP = 25;
export const SAVE_LABELS = ['Home', 'Office', 'Work', 'Other'] as const;

/** A distinct uuid-shaped id per index so React keys / queries stay unique. */
export function fixtureId(seed: number): string {
  const h = (seed >>> 0).toString(16).padStart(8, '0').slice(0, 8);
  return `${h}-1111-4111-8111-1111111111${(seed % 100).toString().padStart(2, '0')}`;
}

/** Arbitrary SavedAddress with realistic, non-empty fields and a unique id. */
export function savedAddressArb(seed = 0): fc.Arbitrary<SavedAddress> {
  return fc
    .record({
      label: fc.constantFrom('Home', 'Office', 'Work', 'Other', 'Mum', 'Shop'),
      address_text: fc.string({ minLength: 3, maxLength: 60 }).map((s) => `${s.trim() || 'Addr'} St`),
      city: fc.constantFrom('Lagos', 'Abuja', 'Ibadan', 'Kano'),
      state: fc.constantFrom('Lagos', 'FCT', 'Oyo', 'Kano'),
      lat: fc.double({ min: 4, max: 14, noNaN: true }),
      lng: fc.double({ min: 2, max: 15, noNaN: true }),
    })
    .map((r) =>
      makeSavedAddress({
        ...r,
        id: fixtureId(seed + Math.floor(r.lat * 1000)),
      }),
    );
}

/** Arbitrary RecentLocation with realistic, non-empty fields and a unique id. */
export function recentLocationArb(seed = 0): fc.Arbitrary<RecentLocation> {
  return fc
    .record({
      address_text: fc.string({ minLength: 3, maxLength: 60 }).map((s) => `${s.trim() || 'Recent'} Ave`),
      city: fc.constantFrom('Lagos', 'Abuja', 'Ibadan', 'Kano'),
      state: fc.constantFrom('Lagos', 'FCT', 'Oyo', 'Kano'),
      lat: fc.double({ min: 4, max: 14, noNaN: true }),
      lng: fc.double({ min: 2, max: 15, noNaN: true }),
    })
    .map((r) =>
      makeRecentLocation({
        ...r,
        id: fixtureId(seed + 500 + Math.floor(r.lng * 1000)),
      }),
    );
}

/** Arbitrary list of SavedAddress with unique ids (0..max). */
export function savedAddressesArb(max = 6): fc.Arbitrary<SavedAddress[]> {
  return fc
    .array(fc.double({ min: 4, max: 14, noNaN: true }), { minLength: 0, maxLength: max })
    .map((lats) =>
      lats.map((lat, i) =>
        makeSavedAddress({
          id: fixtureId(i + 1),
          label: SAVE_LABELS[i % SAVE_LABELS.length],
          address_text: `${i + 1} Marina Road, Lagos`,
          lat,
        }),
      ),
    );
}

/** Arbitrary list of RecentLocation with unique ids (0..max). */
export function recentLocationsArb(max = 6): fc.Arbitrary<RecentLocation[]> {
  return fc
    .array(fc.double({ min: 4, max: 14, noNaN: true }), { minLength: 0, maxLength: max })
    .map((lngs) =>
      lngs.map((lng, i) =>
        makeRecentLocation({
          id: fixtureId(i + 700),
          address_text: `${i + 1} Allen Avenue, Ikeja`,
          lng,
        }),
      ),
    );
}

/**
 * Successful load outcome (non-bug input for the load path): both `list` and
 * `listRecent` resolve `{ data, error: null }`. Generates the saved/recent
 * datasets the fixed hook will populate.
 */
export type SuccessfulLoad = { saved: SavedAddress[]; recent: RecentLocation[] };

export function successfulLoadArb(): fc.Arbitrary<SuccessfulLoad> {
  return fc.record({ saved: savedAddressesArb(), recent: recentLocationsArb() });
}

// ---- Pure derivations mirroring EXACTLY what the FIXED screens render. -------
// These encode the render gates in pickup.tsx / dropoff.tsx so a property can
// assert the fixed output for a successful (non-bug) load equals the original
// happy-path output. For a successful load the hook state is always 'ready', so
// F(X) = F'(X) reduces to "the same array-length gates fire".

/** Chip row (collapsed search) is shown iff there is ≥1 saved address. */
export function chipRowShown(saved: SavedAddress[]): boolean {
  return saved.length > 0;
}

/** The empty-search Recent/Saved panel is shown iff either list is non-empty. */
export function recentSavedSectionShown(
  saved: SavedAddress[],
  recent: RecentLocation[],
): boolean {
  return recent.length > 0 || saved.length > 0;
}

/** The "Recent" sub-header renders iff there is ≥1 recent location. */
export function recentHeaderShown(recent: RecentLocation[]): boolean {
  return recent.length > 0;
}

/** The "Saved" sub-header renders iff there is ≥1 saved address. */
export function savedHeaderShown(saved: SavedAddress[]): boolean {
  return saved.length > 0;
}

/** The save-nudge region is offered iff under the address cap. */
export function saveNudgeShown(savedCount: number): boolean {
  return savedCount < ADDRESS_CAP;
}
