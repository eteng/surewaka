/* eslint-disable @typescript-eslint/no-require-imports */
// Jest setup for apps/mobile-customer.
//
// The three recipient screens (app/booking/recipient.tsx,
// app/profile/recipients.tsx, app/profile/recipient-edit.tsx) render real React
// Native components under jest-expo but import a handful of native / heavy modules
// that either can't load or would hit the network/native bridge in the test env.
// We mock those here so the screens render in node/jsdom. Real Zustand stores and
// the real API client run (transport is stubbed via global.fetch below).

// @testing-library/react-native v14 ships its jest matchers built-in (no
// separate extend-expect import needed).

// React must be told it's in an "act" environment so state updates that land
// after an awaited async boundary (e.g. setState after `await client.create()`)
// are flushed into the rendered tree instead of being dropped with a warning.
// The universal `test-renderer` relies on this global.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- Environment: the API client + connectivity store read these at import time ---
process.env.EXPO_PUBLIC_API_URL = 'https://api.test.local';
process.env.EXPO_PUBLIC_APP_SOURCE = 'jest';
process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = 'pk.test.mapbox.token';

// --- @clerk/expo: useAuth().getToken() must resolve a token without a real session ---
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({
    getToken: jest.fn(async () => 'test-token'),
    isSignedIn: true,
    isLoaded: true,
    userId: 'user_test',
    signOut: jest.fn(async () => {}),
  }),
  useUser: () => ({ user: { id: 'user_test' }, isLoaded: true, isSignedIn: true }),
}));

// --- connectivity store: the real one starts a setTimeout health-poller after
// repeated API failures (e.g. a 500). That timer leaks across tests and can fire
// a /health fetch that consumes a later test's queued fetch response. Stub the
// store so its signal methods are inert no-ops (no timers, no polling). The
// screens under test don't read connectivity state. ---
jest.mock('@surewaka/mobile-shared/src/store/connectivity-store', () => {
  const state = {
    isInternetReachable: null,
    isBackendReachable: true,
    consecutiveFailures: 0,
    status: 'online',
    maintenance: null,
    setInternetReachable: () => {},
    recordApiSuccess: () => {},
    recordApiFailure: () => {},
    setBackendReachable: () => {},
    setMaintenance: () => {},
    clearMaintenance: () => {},
  };
  const useConnectivityStore = () => state;
  useConnectivityStore.getState = () => state;
  useConnectivityStore.setState = () => {};
  useConnectivityStore.subscribe = () => () => {};
  return { useConnectivityStore };
});

// --- addresses-client seam: the REAL useSavedAddresses hook
// (packages/mobile-shared/src/hooks/use-saved-addresses.ts) obtains its client
// from packages/mobile-shared/src/api/addresses-client.ts. The booking-address
// tests drive the hook with a controllable client by overriding
// `createAddressesClient` on their `jest.mock('@surewaka/mobile-shared', ...)`.
// Mock this seam so the hook resolves `createAddressesClient` from that (mocked)
// package export at call-time — routing each test's `mockClient` into the real
// hook while its Promise.all / Sentry / state logic runs unchanged. When a test
// does NOT mock `@surewaka/mobile-shared` (e.g. the recipient suite), it resolves
// via moduleNameMapper to the shim, which re-exports the real factory — so the
// seam stays transparent there too. ---
jest.mock('@surewaka/mobile-shared/src/api/addresses-client', () => ({
  createAddressesClient: (token) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@surewaka/mobile-shared').createAddressesClient(token),
}));

// --- @sentry/react-native: tests assert captureException is called ---
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  init: jest.fn(),
  wrap: (c) => c,
}));

// --- expo-router: push/back are jest.fns; useLocalSearchParams defaults to {} ---
// jest hoists jest.mock() above imports, so the factory may only reference
// variables whose names start with `mock` (jest's allow-list). We stash the
// router + params state on such variables and expose test helpers on global.
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
const mockRouterState = { searchParams: {} };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRouterState.searchParams,
  router: mockRouter,
  Link: 'Link',
  Stack: { Screen: () => null },
}));
// Expose helpers for tests to control router + params without re-mocking.
global.__expoRouterMock = mockRouter;
global.__setSearchParams = (params) => {
  mockRouterState.searchParams = params || {};
};
global.__resetRouterMock = () => {
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.navigate.mockReset();
  mockRouterState.searchParams = {};
};

// --- @expo/vector-icons: stub each icon family with a plain host component name.
// Using a string component (not a JSX-producing function) keeps the nativewind
// babel transform from injecting its interop runtime into this setup file. ---
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  MaterialIcons: 'MaterialIcons',
  FontAwesome: 'FontAwesome',
  Feather: 'Feather',
}));

// --- react-native-safe-area-context: insets = {top,bottom,left,right:0}.
// SafeAreaProvider/SafeAreaView pass through as plain host components. ---
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    SafeAreaProvider: 'SafeAreaProvider',
    SafeAreaView: 'SafeAreaView',
    initialWindowMetrics: { insets: inset, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

// --- nativewind: className is a no-op under test. Mock both the public package
// and its interop engine so the babel-injected cssInterop runtime is inert. ---
jest.mock('nativewind', () => ({
  cssInterop: () => {},
  remapProps: () => {},
  useColorScheme: () => ({ colorScheme: 'light', setColorScheme: jest.fn() }),
  verifyInstallation: () => {},
  styled: (c) => c,
}));

// --- Silence the RN Animated + act warnings noise that clutters property runs ---
jest.spyOn(console, 'warn').mockImplementation((msg) => {
  if (typeof msg === 'string' && /useNativeDriver|not wrapped in act|VirtualizedList/.test(msg)) {
    return;
  }
  // eslint-disable-next-line no-console
});

// --- react-native Alert: profile/recipients.tsx uses Alert.alert() for the
// delete confirmation (a destructive button) and for the delete-failure error.
// Spy on it and, by default, AUTO-PRESS the destructive/confirm button so the
// delete-confirmation flow proceeds under test. Tests can inspect
// Alert.alert.mock.calls, and can opt a specific alert out of auto-press via
// global.__setAlertAutoPress(false). The default is auto-press ON. ---
const _alertState = { autoPress: true };
global.__setAlertAutoPress = (v) => {
  _alertState.autoPress = v !== false;
};
const RN = require('react-native');
jest.spyOn(RN.Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  if (!_alertState.autoPress || !Array.isArray(buttons)) return;
  // Prefer the destructive button (Delete); else the first non-cancel button.
  const destructive = buttons.find((b) => b && b.style === 'destructive');
  const confirm = destructive ?? buttons.find((b) => b && b.style !== 'cancel');
  if (confirm && typeof confirm.onPress === 'function') confirm.onPress();
});

// --- global.fetch stub: the real API client transport calls fetch(). Default to a
//     network-error rejection so no test accidentally hits the network; individual
//     tests install their own jest.fn() responses. ---
if (!global.fetch || !global.fetch._isJestStub) {
  const stub = jest.fn(async () => {
    throw new Error('fetch not stubbed in this test');
  });
  stub._isJestStub = true;
  global.fetch = stub;
}
