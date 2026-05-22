# SureWaka Mobile — Session Handoff

## Project State

This is a Turborepo monorepo. The mobile customer app lives at `apps/mobile-customer/`.

**Last worked on**: Map integration for booking flow (pickup/dropoff with Mapbox + LocationIQ)

## What's Been Built

### Infrastructure
- **NativeWind v4** + **Tailwind v3** — `className` styling across all screens
- **Zustand** — Auth store + Booking store for state management
- **react-hook-form** + **Zod resolver** — Form validation on every input
- **Supabase mobile client** — Phone OTP auth with AsyncStorage persistence
- **ThemeProvider** — Light/dark mode with swappable token system
- **API client** — `createAuthClient(token)` for authenticated requests

### Screens (31 files)
```
app/
├── _layout.tsx                    # ThemeProvider, auth routing
├── (onboarding)/                   # 3-slide carousel + complete
├── (auth)/                         # Phone sign-in + OTP verify
├── (tabs)/                         # Home, Deliveries, Notifications, Profile
├── booking/                        # pickup → dropoff → package → carriers → review → confirmed
├── tracking/                       # [id].tsx + details/[id].tsx
├── profile/                        # edit, addresses, payments, history, help, settings
├── delivery/[id]/                  # rate, receipt, dispute
└── driver/[id].tsx                 # Driver info card
```

### API Integration (Completed)
- **Backend**: `POST /api/v1/deliveries`, `GET /api/v1/deliveries`, `GET /api/v1/deliveries/:id` — all behind `requireAuth`, using Drizzle + Supabase
- **Mobile**: Review screen calls API, confirmed passes real delivery ID, tracking fetches real data with 30s polling, deliveries tab renders list

### Map Integration (Completed)
- **Mapbox GL** (`@rnmapbox/maps`) — interactive maps in pickup/dropoff screens
- **LocationIQ** — address autocomplete + reverse geocoding
- **expo-location** — device GPS
- Pickup: green marker, auto-center on user, tap-to-drop, search
- Dropoff: red marker + shows pickup location as secondary marker

## What Still Needs Work

### 1. Env Variables (Required to run)
Add to `apps/mobile-customer/.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token
EXPO_PUBLIC_LOCATIONIQ_API_KEY=pk.your_locationiq_key
```

### 2. EAS Build (Needed for native modules)
```bash
# Development build (first time)
eas build --profile development --platform android

# Or iOS
eas build --profile development --platform ios
```
The app uses `@rnmapbox/maps` which requires native modules — Expo Go won't work.

### 3. Real Carrier Data
`booking/carriers.tsx` still uses mock carriers. Connect to `GET /api/v1/carriers` endpoint.

### 4. Payment Integration
Review screen's "Confirm & Pay" creates delivery but doesn't process payment. Add Paystack flow.

### 5. Push Notifications
Not yet implemented. Use `expo-notifications` + register device token.

### 6. Real-Time Tracking
Tracking polls every 30s. Upgrade to Supabase Realtime subscription.

### 7. Map Migration Path (Future)
- Mapbox tiles → OpenStreetMap tiles (swap `styleURL`)
- LocationIQ → Nominatim (free, same API, rate-limited)

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| NativeWind v4 + Tailwind v3 | Consistent with web apps' Tailwind convention |
| Zustand over Redux/Context | Minimal boilerplate, perfect for auth + booking state |
| react-hook-form + Zod | Reuses existing Zod schemas from `@surewaka/shared` |
| Mapbox over react-native-maps | Best RN performance, EAS handles native deps |
| LocationIQ over Google Places | Cheaper, $50/mo free tier, Nigeria coverage |
| Auth in `_layout.tsx` | No separate splash route, native splash via app.json |
| README structure followed | Production-grade routing with nested stacks |

## Commands

```bash
# Mobile app only
pnpm --filter @surewaka/mobile-customer dev
pnpm --filter @surewaka/mobile-customer dev:ios
pnpm --filter @surewaka/mobile-customer dev:android

# API only
pnpm --filter @surewaka/api dev

# Type check
pnpm --filter @surewaka/mobile-customer exec tsc --noEmit
pnpm --filter @surewaka/mobile-shared exec tsc --noEmit
pnpm --filter @surewaka/api exec tsc --noEmit

# Full monorepo
pnpm dev
pnpm build
pnpm lint
```

## File Boundaries

| Package | Owns |
|---------|------|
| `apps/mobile-customer` | All screens, app.json, tailwind.config.ts, babel.config.js |
| `packages/mobile-shared` | Theme, auth store, booking store, Supabase client, API client, maps |
| `packages/shared` | Zod validators, domain types, constants |
| `apps/api` | Hono routes, middleware, services |
| `packages/db` | Drizzle schema, client |
| `packages/supabase` | Server/browser Supabase clients |

## Known TypeScript Issues

- `packages/shared` test files have pre-existing type errors (missing exports for RBAC validators) — source files are clean
- `packages/mobile-shared/src/maps/locationiq.ts` — `API_KEY` uses `?? ''` fallback; throws at runtime if not set

## Migration: Mapbox → OpenStreetMap (Future)

When ready to switch:
1. Replace `Mapbox.MapView` with a webview-based OSM renderer or `react-native-maps`
2. Swap `styleURL={Mapbox.StyleURL.Street}` → OSM tile URL
3. Replace LocationIQ with Nominatim: `https://nominatim.openstreetmap.org/search`
4. Same API shape, just change base URL

## Next Session Should Start With

1. Verify env vars are set in `.env.local`
2. Run `eas build --profile development --platform android` (or iOS)
3. Test the full booking flow: onboarding → auth → pickup (map) → dropoff (map) → package → carriers → review → confirmed → tracking
4. Fix any runtime issues from the map integration
