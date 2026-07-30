# Network Resilience — Future Enhancements

Phase 1 (current) covers: connectivity store, NetInfo listener, ConnectivityBanner, API client timeout + error classification, and health-check polling with exponential backoff.

## Phase 2 — Refinements

- [ ] **Add jitter to health-check backoff** — prevent thundering herd if multiple clients poll simultaneously
- [ ] **Bump FAILURE_THRESHOLD to 3** — after real-world testing, 2 may be too sensitive (slow cold starts on Fly.io can trigger false degraded state)
- [ ] **Cold-start grace period** — don't count the first API call (e.g., `checkProfile` on app launch) towards the failure threshold; Fly.io machine wake-up can take 5-10s
- [ ] **Increase timeout for initial profile check** — or skip timeout for the very first request after app launch
- [ ] **"Reconnecting..." UI state** — show a third banner state during health polling so user knows recovery is in progress
- [ ] **Slow connection state** — detect requests that succeed but take >5s and show "Slow connection" instead of degraded
- [ ] **Per-feature degradation** — if only one endpoint fails (e.g., wallet) but others work, don't show global banner; degrade inline per-section

## Phase 3 — Offline-First

- [ ] **Offline mutation queue** — queue POST/PATCH requests when offline, flush on reconnect (with idempotency keys)
- [ ] **Stale data indicators** — show "last updated X min ago" on cached data when backend is unreachable
- [ ] **Optimistic UI for bookings** — allow users to start a booking flow offline, submit when connection returns
- [ ] **AsyncStorage cache layer** — cache recent deliveries/profile for instant display on app open, refresh in background
- [ ] **Background fetch** — use `expo-background-fetch` to process offline queue even when app is backgrounded (iOS limitations apply)

## Notes

- expo-doctor `react-native` duplicate warning is a pnpm monorepo false positive (same version, different virtual store symlinks) — won't affect builds
- `@react-native-community/netinfo` requires a dev client rebuild (EAS) to function; without it the hook no-ops gracefully
- Health poller only runs when internet is reachable but backend is down — stops automatically when device goes offline or backend recovers

---

# Booking — Graceful "No Carriers" Handling

When a user books a delivery from a city with no active carrier parks, the app currently shows a generic "booking failed" error. This should be a user-friendly state instead.

## Requirements

- [ ] Detect `No active carrier parks in pickup city` error from routing worker
- [ ] Show a friendly screen: "We're not available in [city] yet"
- [ ] Offer CTA: "Notify me when we launch here" (collect interest for expansion planning)
- [ ] Alternatively suggest the nearest supported city if within reasonable distance
- [ ] Don't show this as a "failure" — it's an availability gap, not an error

## Related

- Routing worker returns this when `carrier_parks` has no rows matching the pickup city
- City resolution comes from reverse geocode — may need to map LGAs to nearest hub city (e.g., Biase → Calabar)
