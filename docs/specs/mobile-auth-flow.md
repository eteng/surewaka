# Mobile Auth Flow — Use Cases & Implementation Plan

## Current Architecture

```
ClerkProvider (manages session)
  └─ InnerLayout (_layout.tsx)
       ├─ useAuth() → isSignedIn, isLoaded, getToken, signOut
       ├─ useAuthStore → profileExists (null | true | false)
       └─ Stack
            ├─ (onboarding)   — first-time app open
            ├─ (auth)         — sign-in, verify, register
            │    └─ _layout.tsx guard: if signed in + profile → Redirect to (tabs)
            ├─ (tabs)         — main app
            │    └─ _layout.tsx guard: if not signed in → Redirect to (auth)
            └─ ... (booking, tracking, etc.)
```

## All Use Cases

### UC1: Cold start — new user, never opened app
- **State:** isSignedIn=false, profileExists=null
- **Expected:** Show onboarding → sign-in
- **Current:** ✅ Works (Stack renders, onboarding is first screen)

### UC2: Cold start — returning user, has profile
- **State:** isSignedIn=true, profileExists=null → true
- **Expected:** Show (tabs) home immediately (or with brief loading)
- **Current:** ⚠️ 2-3s pause while checkProfile hits network, then (tabs)
- **Ideal:** Cache profileExists in AsyncStorage, use cached value instantly, revalidate in background

### UC3: OTP verified — new user, needs registration
- **State:** isSignedIn flips true, profileExists=null → false
- **Expected:** Verify spinner → register screen
- **Current:** ⚠️ Verify spinner holds 2-3s (network call), then router.replace to register
- **Issue:** Brief flash of wrong screen possible between Stack mount and useEffect

### UC4: OTP verified — returning user, has profile
- **State:** isSignedIn flips true, profileExists=null → true
- **Expected:** Verify spinner → (tabs) home
- **Current:** ✅ Works (spinner holds, then (tabs) via auth layout guard)

### UC5: Session revoked — user deleted from Clerk dashboard
- **State:** Clerk's internal refresh throws "No session was found"
- **Expected:** Redirect to sign-in, no crash
- **Current:** ❌ App crashes (unhandled promise rejection from Clerk's internal timer)
- **Root cause:** Clerk's background token refresh fires independently, throws before our getToken() catch can run

### UC6: Session expired naturally — token refresh fails
- **State:** Clerk refreshes token, Clerk backend rejects
- **Expected:** isSignedIn flips false → redirect to sign-in
- **Current:** ✅ Works when Clerk handles it cleanly (isSignedIn flips)

### UC7: Network down during profile check
- **State:** isSignedIn=true, checkProfile fails with NETWORK_ERROR
- **Expected:** Stay in app, show connectivity banner, don't redirect to register
- **Current:** ✅ Fixed (profileExists stays null, no redirect)

### UC8: API down during profile check (maintenance)
- **State:** isSignedIn=true, checkProfile gets 503 MAINTENANCE
- **Expected:** Show maintenance screen
- **Current:** ✅ Works (apiClient signals maintenance store)

### UC9: User signs out manually
- **State:** signOut() called → isSignedIn flips false
- **Expected:** Redirect to sign-in
- **Current:** ✅ Works via (tabs) layout guard

---

## Problems to Solve

| # | Problem | Severity | Root Cause |
|---|---------|----------|------------|
| 1 | App crash on session revocation (UC5) | Critical | Clerk's internal unhandled promise rejection |
| 2 | 2-3s pause after OTP (UC3, UC4) | UX polish | Network call blocks navigation |
| 3 | Possible flash of wrong screen (UC3) | Minor | useEffect fires after render |

---

## Implementation Plan

### Phase 1: Fix the crash (UC5) — Critical

**Approach:** Global unhandled promise rejection handler that intercepts Clerk's session errors.

**Why not signOut() in catch?**
Our `.catch()` on `getToken()` only handles OUR call. Clerk's internal background timer makes its own calls that we can't wrap.

**Implementation:**

```ts
// In _layout.tsx, before any component code (module-level)
// Override the rejection tracking to suppress Clerk session errors

import { LogBox } from 'react-native';

// Suppress the red screen for Clerk session errors in dev
if (__DEV__) {
  LogBox.ignoreLogs(['No session was found']);
}
```

For production crash prevention:
```ts
// In entry point (before Sentry.init or as Sentry beforeSend filter)
Sentry.init({
  // ...existing config
  beforeSend(event) {
    // Don't report Clerk session-not-found as a crash
    const message = event.exception?.values?.[0]?.value ?? '';
    if (message.includes('No session was found')) {
      return null; // Drop the event
    }
    return event;
  },
});
```

And add a **periodic session validity check** that calls `signOut()` when the session is dead:
```ts
// Poll every 30s: if isSignedIn but getToken() returns null/throws → signOut()
useEffect(() => {
  if (!isSignedIn) return;
  
  const interval = setInterval(async () => {
    try {
      const token = await getToken();
      if (!token) await signOut();
    } catch {
      await signOut().catch(() => {});
    }
  }, 30_000);
  
  return () => clearInterval(interval);
}, [isSignedIn]);
```

### Phase 2: Eliminate the pause (UC2, UC3, UC4) — UX Polish

**Approach:** Cache `profileExists` in AsyncStorage.

**Implementation:**

```ts
// In auth-store.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILE_CACHE_KEY = '@surewaka:profileExists';

// On successful profile check, cache the result
checkProfile: async (token: string) => {
  // 1. Read cache first for instant navigation
  const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
  if (cached !== null) {
    set({ profileExists: cached === 'true', loading: false });
  }
  
  // 2. Revalidate from network
  const response = await apiClient.get('/api/v1/profile', token);
  const exists = !response.error || response.error.code !== 'PROFILE_REQUIRED';
  
  set({ profileExists: exists, loading: false });
  await AsyncStorage.setItem(PROFILE_CACHE_KEY, String(exists));
}

// On sign out, clear cache
reset: () => {
  set({ profileExists: null, loading: true });
  AsyncStorage.removeItem(PROFILE_CACHE_KEY);
}
```

**Result:**
- Returning users: instant navigation (cached `true`)
- New users (first time): still 2-3s wait (no cache, must hit network)
- After registration completes: cache set to `true`, subsequent opens are instant

### Phase 3: Fix screen flash (UC3) — Minor

**Approach:** Set `(auth)` as the initial route name, so when the Stack first mounts for an unauthenticated-but-signed-in user, it lands on `(auth)` which contains both sign-in and register.

```tsx
<Stack screenOptions={{ headerShown: false }} initialRouteName="(auth)">
```

Combined with the `(auth)/_layout.tsx` guard:
```tsx
// Already handles: signed in + profile → Redirect to (tabs)
// Add: signed in + no profile → show register as initial screen
if (isSignedIn && profileExists === false) {
  return (
    <Stack initialRouteName="register">
      <Stack.Screen name="register" />
      {/* ... */}
    </Stack>
  );
}
```

This eliminates the useEffect race — the correct screen is the initial render.

---

## Execution Order

1. **Phase 1** — Fix crash. Unblock testing. (~30 min)
2. **Phase 2** — Cache. Eliminate pause for 99% of app opens. (~30 min)
3. **Phase 3** — Flash fix. Only matters for new user first-time flow. (~15 min)

---

## Testing Matrix

| Scenario | Steps | Expected |
|----------|-------|----------|
| New user first time | Open app → sign in → OTP | Spinner → register → home |
| Returning user | Kill app → reopen | Instant home (cached) |
| Session revoked | Sign in → delete user in Clerk dashboard | Redirect to sign-in, no crash |
| Network down on open | Turn off wifi → open app | Show cached home + connectivity banner |
| Sign out | Tap sign out | Back to sign-in screen |
| API maintenance | Enable MAINTENANCE_MODE | Maintenance screen, auto-recover |
