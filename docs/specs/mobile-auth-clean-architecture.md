# Mobile Auth — Proposed Clean Architecture

## Design Principles

1. **Never conditionally unmount the Stack** — Expo Router loses navigation state
2. **Never use `router.replace` for auth routing** — race conditions with render cycle
3. **Each layout guard owns ONE decision** — no god-component in root _layout
4. **Cache-first, network-second** — no visible wait for returning users
5. **Fail to sign-in, not crash** — any auth error results in a clean sign-in screen

---

## Route Structure

```
app/
  _layout.tsx              → RootLayout: providers only, always renders Stack
  (loading).tsx            → Full-screen branded splash (shown while auth resolves)
  (auth)/
    _layout.tsx            → AuthGuard: bounces to (tabs) if fully authenticated
    sign-in.tsx
    verify.tsx
    register.tsx
  (tabs)/
    _layout.tsx            → AppGuard: bounces to (auth) if not authenticated
    index.tsx
    ...
  (onboarding)/
    _layout.tsx
    index.tsx
```

---

## Root Layout — Minimal, No Logic

```tsx
// app/_layout.tsx
export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={KEY} tokenCache={tokenCache}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <StatusBar style="auto" />
          <AuthGate />
          <ConnectivityBanner />
          <MaintenanceScreen />
          <Toaster position="bottom-center" richColors />
        </ThemeProvider>
      </GestureHandlerRootView>
    </ClerkProvider>
  );
}
```

---

## AuthGate — The Single Decision Point

A dedicated component that resolves auth state and renders the **correct initial route group** without ever needing `router.replace`:

```tsx
// app/_layout.tsx (inside RootLayout, replaces InnerLayout)

function AuthGate() {
  const { isSignedIn, isLoaded, getToken, signOut } = useAuth();
  const { user } = useUser();
  const profileExists = useAuthStore((s) => s.profileExists);
  const checkProfile = useAuthStore((s) => s.checkProfile);
  const reset = useAuthStore((s) => s.reset);

  useNetInfoListener();
  usePushNotifications({ app: 'customer' });
  useSessionWatchdog(isSignedIn, getToken, signOut); // handles UC5

  // Trigger profile check when signed in
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    getToken()
      .then((token) => { if (token) checkProfile(token); })
      .catch(() => { signOut().catch(() => {}); });
  }, [isLoaded, isSignedIn]);

  // Clear state on sign out
  useEffect(() => {
    if (isLoaded && !isSignedIn) reset();
  }, [isLoaded, isSignedIn]);

  // Always render the Stack — guards inside each group handle routing
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(loading)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="booking" />
      {/* ...other screens */}
    </Stack>
  );
}
```

---

## (loading) — Branded Splash Screen

A simple screen that acts as the initial route. Each layout guard redirects away from it:

```tsx
// app/(loading).tsx
export default function LoadingScreen() {
  return (
    <View className="flex-1 bg-white items-center justify-center">
      <Image source={require('../assets/logo.png')} className="w-20 h-20" />
      <ActivityIndicator size="small" color="#16a34a" className="mt-6" />
    </View>
  );
}
```

Set it as the initial route in the Stack:
```tsx
<Stack screenOptions={{ headerShown: false }} initialRouteName="(loading)">
```

---

## Layout Guards — Each Owns One Decision

### (auth)/_layout.tsx

```tsx
export default function AuthLayout() {
  const { isSignedIn } = useAuth();
  const profileExists = useAuthStore((s) => s.profileExists);

  // Fully authenticated → go to app
  if (isSignedIn && profileExists === true) {
    return <Redirect href="/(tabs)" />;
  }

  // Signed in but no profile → show register as initial screen
  return (
    <Stack
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      initialRouteName={isSignedIn && profileExists === false ? 'register' : 'sign-in'}
    />
  );
}
```

**Key insight:** `initialRouteName` is set dynamically. When `profileExists === false`, the Stack starts on `register` — no redirect needed, no flash.

### (tabs)/_layout.tsx

```tsx
export default function TabLayout() {
  const { isSignedIn } = useAuth();
  const profileExists = useAuthStore((s) => s.profileExists);

  // Not signed in → auth flow
  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Signed in but no profile → register
  if (profileExists === false) {
    return <Redirect href="/(auth)/register" />;
  }

  // profileExists === null → still checking, show nothing (loading screen is behind)
  if (profileExists === null) {
    return null; // (loading) screen is still visible underneath
  }

  return <Tabs>{/* ... */}</Tabs>;
}
```

### Navigation from (loading)

The (loading) screen needs to navigate away once auth state resolves:

```tsx
// app/(loading).tsx
export default function LoadingScreen() {
  const { isSignedIn, isLoaded } = useAuth();
  const profileExists = useAuthStore((s) => s.profileExists);

  // Wait for Clerk to load
  if (!isLoaded) return <BrandedSplash />;

  // Not signed in → auth
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  // Signed in, profile confirmed → tabs
  if (profileExists === true) return <Redirect href="/(tabs)" />;

  // Signed in, no profile → register
  if (profileExists === false) return <Redirect href="/(auth)/register" />;

  // Still checking (null) → keep showing splash
  return <BrandedSplash />;
}

function BrandedSplash() {
  return (
    <View className="flex-1 bg-white items-center justify-center">
      <ActivityIndicator size="large" color="#16a34a" />
    </View>
  );
}
```

---

## Session Watchdog — Handles UC5 (Revocation)

A custom hook that periodically validates the session and calls `signOut()` if dead:

```tsx
// packages/mobile-shared/src/hooks/use-session-watchdog.ts

export function useSessionWatchdog(
  isSignedIn: boolean,
  getToken: () => Promise<string | null>,
  signOut: () => Promise<void>,
) {
  useEffect(() => {
    if (!isSignedIn) return;

    const interval = setInterval(async () => {
      try {
        const token = await getToken();
        if (!token) {
          await signOut().catch(() => {});
        }
      } catch {
        await signOut().catch(() => {});
      }
    }, 30_000); // Check every 30s

    return () => clearInterval(interval);
  }, [isSignedIn, getToken, signOut]);
}
```

This catches Clerk's "No session found" before it becomes an unhandled rejection.

---

## AsyncStorage Profile Cache — Eliminates Pause

```tsx
// In auth-store.ts

const PROFILE_CACHE_KEY = '@surewaka:profile_exists';

checkProfile: async (token: string) => {
  // 1. Use cache for instant UI (optimistic)
  const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
  if (cached === 'true') {
    set({ profileExists: true, loading: false });
    // Still revalidate in background (don't await)
  }

  // 2. Network check (authoritative)
  const response = await apiClient.get<{ id: string }>('/api/v1/profile', token);

  if (response.error) {
    if (response.error.category === 'not_found' || response.error.code === 'PROFILE_REQUIRED') {
      set({ profileExists: false, loading: false });
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, 'false');
    } else {
      // Network/server error — use cache if available, otherwise null
      if (cached === null) set({ profileExists: null, loading: false });
    }
    return;
  }

  set({ profileExists: true, loading: false });
  await AsyncStorage.setItem(PROFILE_CACHE_KEY, 'true');
},

reset: () => {
  set({ profileExists: null, loading: true });
  AsyncStorage.removeItem(PROFILE_CACHE_KEY);
  Sentry.setUser(null);
},
```

---

## Flow Diagrams

### Returning user (cached):
```
App opens → (loading) → reads cache (true) → Redirect to (tabs) → Home
                                              ~0ms delay
```

### New user (first time):
```
App opens → (loading) → not signed in → Redirect to (auth)/sign-in
         → OTP → verify → Clerk session active
         → (loading) re-evaluates → profileExists=null → show splash
         → checkProfile returns false → Redirect to (auth)/register
         → register → submit → profileExists=true → Redirect to (tabs)
                                ~2-3s on the splash (one time only)
```

### Session revoked:
```
User on (tabs) → watchdog getToken() throws → signOut()
              → isSignedIn=false → (tabs) guard → Redirect to (auth)/sign-in
```

---

## Why This Is Better

| Problem | Old approach | New approach |
|---------|-------------|--------------|
| Flash of wrong screen | useEffect fires after render | initialRouteName + Redirect in (loading) |
| Infinite loop | Redirect within same layout | Each layout only Redirects OUT |
| Stack unmounting | Conditional return in root | Stack always mounted |
| Crash on revocation | Unhandled promise | Session watchdog + signOut |
| 2-3s pause | Every app open | Only first time (cache after) |
| God component | _layout.tsx does everything | Loading screen + layout guards each own one decision |

---

## Implementation Order

1. Create `(loading).tsx` screen
2. Refactor `_layout.tsx` to minimal AuthGate (always render Stack)
3. Update `(auth)/_layout.tsx` with dynamic initialRouteName
4. Add AsyncStorage cache to auth-store
5. Add useSessionWatchdog hook
6. Test all 9 use cases from the testing matrix
