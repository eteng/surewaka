# @surewaka/mobile-customer

Customer-facing mobile app for SureWaka. Built with Expo and React Native.

## What it does

- Book deliveries (compare carriers or instant driver matching)
- Real-time package tracking
- Manage delivery addresses
- Payment and delivery history

## Tech Stack

- **Framework**: Expo Router (file-based routing)
- **Styling**: NativeWind (Tailwind CSS for React Native)
- **State**: Zustand (auth store, booking store)
- **Forms**: react-hook-form + Zod resolver
- **Validation**: Zod schemas from `@surewaka/shared`
- **Auth**: Supabase phone OTP
- **Theme**: ThemeProvider with light/dark mode support

## Development

```bash
# Start Expo dev server
pnpm --filter @surewaka/mobile-customer dev

# iOS simulator
pnpm --filter @surewaka/mobile-customer dev:ios

# Android emulator
pnpm --filter @surewaka/mobile-customer dev:android
```

## Structure

```
app/
├── _layout.tsx                    # Root — ThemeProvider, auth routing
├── (onboarding)/
│   ├── _layout.tsx
│   ├── index.tsx                  # 3-slide carousel
│   └── complete.tsx               # Profile setup
├── (auth)/
│   ├── _layout.tsx
│   ├── sign-in.tsx                # Phone input
│   └── verify.tsx                 # OTP
├── (tabs)/
│   ├── _layout.tsx                # Tab bar (4 tabs)
│   ├── index.tsx                  # Home
│   ├── deliveries.tsx             # Delivery list
│   ├── notifications.tsx          # Notifications
│   └── profile.tsx                # Profile hub
├── booking/
│   ├── _layout.tsx                # Booking stack (6 steps)
│   ├── pickup.tsx
│   ├── dropoff.tsx
│   ├── package.tsx
│   ├── carriers.tsx
│   ├── review.tsx
│   └── confirmed.tsx
├── tracking/
│   ├── [id].tsx                   # Live map + status
│   └── details/[id].tsx           # Full delivery info
├── profile/
│   ├── edit.tsx
│   ├── addresses.tsx
│   ├── payments.tsx
│   ├── history.tsx
│   ├── help.tsx
│   └── settings.tsx
├── delivery/
│   ├── [id]/rate.tsx              # Rate driver
│   ├── [id]/receipt.tsx           # Receipt
│   └── [id]/dispute.tsx           # Report issue
└── driver/[id].tsx                # Driver info card
```

## Shared Code

- **Theme**: `packages/mobile-shared/src/theme.tsx` — ThemeProvider, light/dark tokens
- **Auth store**: `packages/mobile-shared/src/store/auth-store.ts` — Zustand + Supabase
- **Booking store**: `packages/mobile-shared/src/store/booking-store.ts` — Multi-step form state
- **Supabase client**: `packages/mobile-shared/src/supabase.ts` — Mobile client with AsyncStorage
- **Validators**: `packages/shared/src/validators.ts` — Zod schemas (phoneOtp, otpVerify, package, etc.)

## Related

- See [ADR-004](../../docs/decisions/004-separate-mobile-apps.md) for why this is separate from the driver app
- Shared code lives in `packages/mobile-shared`
