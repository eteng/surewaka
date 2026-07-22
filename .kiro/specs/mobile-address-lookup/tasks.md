# Tasks — Mobile Address Lookup

Implementation order: schema → validators → API → mobile client → screens → booking integration.

---

- [x] 1. **DB migration** — create `user_saved_addresses` and `recent_locations` tables with RLS policies in a single migration
  - Run `pnpm db:generate new add_address_lookup_tables`
  - `user_saved_addresses`: id, user_id, label, address_text, city, state, lat, lng, created_at (no is_default)
  - `recent_locations`: id, user_id, address_text, city, state, lat, lng, used_at
  - RLS on both tables: users manage own rows
  - Run `pnpm db:generate fetch --yes` to apply

- [x] 2. **Drizzle schema** — add `userSavedAddresses` and `recentLocations` table definitions to `packages/db/src/schema.ts`

- [x] 3. **Zod validators** — add `savedAddressSchema` / `createSavedAddressSchema` / `updateSavedAddressSchema` to `packages/shared/src/validators/saved-address.ts`; add `recentLocationSchema` / `upsertRecentLocationSchema` to `packages/shared/src/validators/recent-location.ts`; export both from package index

- [x] 4. **`reverseGeocode()` update** — change return type from `string | null` to `LocationSuggestion | null` in `packages/mobile-shared/src/maps/locationiq.ts`; update callers in `booking/pickup.tsx` and `booking/dropoff.tsx` to read `.display_name`

- [x] 5. **Address service** — create `apps/api/src/services/address-service.ts` with `listAddresses`, `getAddress`, `createAddress` (25-cap check → `LIMIT_REACHED`), `updateAddress`, `deleteAddress`; explicit `WHERE userId = ?` on every query

- [x] 6. **Recent location service** — create `apps/api/src/services/recent-location-service.ts` with `listRecent` and `upsertRecent`; upsert matches on `(user_id, address_text)`, updates `used_at` + coords if exists, otherwise inserts and evicts oldest row if count > 5; runs in a single Drizzle transaction

- [x] 7. **API routes** — create `apps/api/src/routes/addresses.ts` with all 7 handlers behind `requireAuth`; register `/recent` routes before `/:id` to avoid Hono match conflict; register on the Hono app

- [x] 8. **Mobile-shared client** — add `createAddressesClient` (saved + recent methods) to `packages/mobile-shared/src/api/addresses.ts`; export from package index

- [x] 9. **Profile addresses screen** — replace shell in `apps/mobile-customer/app/profile/addresses.tsx` with real API data, swipe-to-delete with confirmation, cap message at 25, navigation to address-edit

- [x] 10. **Address edit screen** — create `apps/mobile-customer/app/profile/address-edit.tsx`; reads optional `id` param; fetches `GET /addresses/:id` in edit mode; label chips + free-text input; LocationIQ search + Mapbox map with tap-to-drop; extracts `city`/`state` from structured LocationIQ response; POST or PUT on save

- [x] 11. **Booking quick-select chips** — add saved address chip row to `booking/pickup.tsx` and `booking/dropoff.tsx`; fetch on mount; chip tap sets coords + address + flies camera; hidden when no saved addresses

- [x] 12. **Search panel — Recent + Saved sections** — when search bar focused and `query.length < 3`, show stacked Recent (from `listRecent`) and Saved (already fetched) sections in the suggestions list; when `query.length >= 3`, revert to LocationIQ autocomplete; tapping either section calls `selectSuggestion()` with the stored coords

- [x] 13. **Inline save nudge** — add preset label chips ("Home", "Office", "Work", "Other") to the address confirmation card in both booking screens; hidden when `savedAddresses.length >= 25`; chip tap POSTs to `/addresses` and shows "Saved as [label] ✓"; silent on failure

- [x] 14. **Recent location write on confirm** — in `handleConfirm` in `booking/pickup.tsx` and `booking/dropoff.tsx`, fire-and-forget `upsertRecent()` with the confirmed address; no await, no error handling
