# @surewaka/mobile-driver

Driver-facing mobile app for SureWaka. Built with Expo and React Native.

## What it does

- View and accept nearby delivery jobs
- Navigate to pickup and drop-off locations
- Capture proof-of-delivery photos
- Track earnings and delivery history
- Light fleet dispatch view for owner-operators

## Development

```bash
# Start Expo dev server
pnpm --filter @surewaka/mobile-driver dev

# iOS simulator
pnpm --filter @surewaka/mobile-driver dev:ios

# Android emulator
pnpm --filter @surewaka/mobile-driver dev:android
```

## Structure

```
app/
├── _layout.tsx          # Root layout (Stack navigator)
├── (tabs)/              # Tab-based navigation
│   ├── _layout.tsx      # Tab bar config
│   ├── index.tsx        # Job queue — available deliveries
│   ├── active.tsx       # Active delivery with map
│   ├── earnings.tsx     # Earnings dashboard
│   └── profile.tsx      # Driver profile & documents
└── delivery/[id].tsx    # Delivery detail — navigate & confirm
```

## Permissions

This app requires:
- **Location (background)** — real-time driver tracking
- **Camera** — proof-of-delivery photos

## Related

- See [ADR-004](../../docs/decisions/004-separate-mobile-apps.md) for why this is separate from the customer app
- Shared code lives in `packages/mobile-shared`
