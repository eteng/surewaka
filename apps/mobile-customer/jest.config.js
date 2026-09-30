/** @type {import('jest').Config} */
// jest-expo drives the RN/Expo transform (Babel via babel-preset-expo) so the
// three screens — which render real React Native components — can be rendered in
// the jsdom test environment. Plain ts-jest (used in packages/mobile-shared) is
// insufficient here because these are .tsx screens importing RN + native modules.
module.exports = {
  preset: 'jest-expo',
  // The screens render RN components + use react-hook-form + zod; jsdom gives us
  // a DOM-ish environment @testing-library/react-native's host component queries
  // are happy with under the expo preset.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // jest-expo's preset already transforms react-native/@react-native/expo/@expo/
  // @sentry/react-native and anything under .pnpm. We extend it to be explicit
  // about the ESM-shipping native/RN modules the screens (transitively) import so
  // they are Babel-transformed rather than choking the CommonJS loader.
  // Under pnpm every dep lives in node_modules/.pnpm/<name>@<version>/... where
  // scoped names have their "/" replaced by "+" (e.g. @react-native+jest-preset).
  // These modules ship untranspiled ESM and MUST be Babel-transformed. The single
  // .pnpm negative-lookahead below transforms the RN/Expo/nativewind ESM surface
  // (and jest-expo's own preset setup files) while ignoring everything else.
  transformIgnorePatterns: [
    '/node_modules/\\.pnpm/(?!(' +
      [
        'react-native',
        '@react-native',
        '@react-native-community',
        'expo',
        'expo-.*',
        '@expo',
        '@expo-google-fonts',
        'nativewind',
        'react-native-css-interop',
        '@sentry',
        '@rnmapbox',
        '@clerk',
        'react-native-safe-area-context',
        'react-native-reanimated',
        'react-native-worklets',
        'react-native-gesture-handler',
        'react-navigation',
        '@react-navigation',
        'zustand',
        '@surewaka',
      ].join('|') +
      ')[@+])',
    // Reanimated's babel plugin and RN's babel-preset must NOT be transformed
    // (they are part of the transformer pipeline itself). Mirrors jest-expo.
    '/node_modules/\\.pnpm/react-native-reanimated@[^/]+/node_modules/react-native-reanimated/plugin/',
    '/node_modules/\\.pnpm/@react-native\\+babel-preset@',
  ],
  moduleNameMapper: {
    // @sentry/react-native: under pnpm the app and packages/mobile-shared resolve
    // DIFFERENT physical copies of this package (distinct .pnpm hashes). The
    // jest.mock('@sentry/react-native', ...) in jest.setup.js only replaces one
    // resolution, so the REAL useSavedAddresses hook (which lives in
    // packages/mobile-shared) would import an UNMOCKED Sentry and its
    // captureException calls would be invisible to the app's spy. Collapse every
    // resolution onto a single instance so the mock applies uniformly and the
    // hook's Sentry reporting is observable in the booking-address tests.
    '^@sentry/react-native$': require.resolve('@sentry/react-native'),
    // react-native-safe-area-context: same pnpm dual-resolution issue as Sentry.
    // useBottomActionInset lives in packages/mobile-shared and would otherwise
    // import a DIFFERENT physical copy than the app, bypassing the
    // jest.mock('react-native-safe-area-context', ...) in jest.setup.js and
    // throwing "No safe area value available". Collapse onto one instance so the
    // mock applies uniformly.
    '^react-native-safe-area-context$': require.resolve('react-native-safe-area-context'),
    // @surewaka/shared is pure TS (zod validators/types) — resolve to source.
    '^@surewaka/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    // @surewaka/mobile-shared's barrel index pulls in heavy transitive modules
    // (ably realtime, push-notifications, netinfo, mapbox). The screens only use
    // useBookingStore / useRecipientStore / createRecipientsClient, so we resolve
    // the package to a slim shim that re-exports the REAL store + client modules
    // via jest.requireActual — real Zustand stores, no network, no native heavy deps.
    '^@surewaka/mobile-shared$': '<rootDir>/test/mobile-shared-shim.ts',
  },
  // App source lives under app/ and __tests__/; only pick up our test files.
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
};
