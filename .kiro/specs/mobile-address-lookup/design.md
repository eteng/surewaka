# Design — Mobile Address Lookup

## Architecture

This feature follows the established monorepo pattern: DB → shared validators → API routes → service layer → mobile-shared client methods → React Native screens.

No new packages required. All changes are additive.

---

## Data Model

### New table: `user_saved_addresses`

```sql
create table user_saved_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text not null,
  address_text text not null,
  city         text not null,
  state        text not null,
  lat          numeric(10, 7) not null,
  lng          numeric(10, 7) not null,
  created_at   timestamptz not null default now()
);

alter table user_saved_addresses enable row level security;
create policy "users manage own addresses"
  on user_saved_addresses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

No `is_default` column. `city` and `state` stored at save time from the LocationIQ structured response — not re-derived on chip selection. Labels are not unique per user.

### New table: `recent_locations`

```sql
create table recent_locations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  address_text text not null,
  city         text not null,
  state        text not null,
  lat          numeric(10, 7) not null,
  lng          numeric(10, 7) not null,
  used_at      timestamptz not null default now()
);

alter table recent_locations enable row level security;
create policy "users manage own recent locations"
  on recent_locations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

**Upsert strategy:** match on `(user_id, address_text)`. If a row exists, update `used_at` and coords. If new, insert and delete the oldest row if the user's count exceeds 5. All writes are fire-and-forget from the mobile client.

### Drizzle schema (`packages/db/src/schema.ts`)

```ts
export const userSavedAddresses = pgTable('user_saved_addresses', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull(),
  label:       text('label').notNull(),
  addressText: text('address_text').notNull(),
  city:        text('city').notNull(),
  state:       text('state').notNull(),
  lat:         numeric('lat', { precision: 10, scale: 7 }).notNull(),
  lng:         numeric('lng', { precision: 10, scale: 7 }).notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const recentLocations = pgTable('recent_locations', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull(),
  addressText: text('address_text').notNull(),
  city:        text('city').notNull(),
  state:       text('state').notNull(),
  lat:         numeric('lat', { precision: 10, scale: 7 }).notNull(),
  lng:         numeric('lng', { precision: 10, scale: 7 }).notNull(),
  usedAt:      timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
});
```

---

## Zod Validators (`packages/shared/src/validators/`)

### `saved-address.ts`

```ts
export const savedAddressSchema = z.object({
  id:           z.string().uuid(),
  label:        z.string().min(1).max(50),
  address_text: z.string().min(1),
  city:         z.string(),
  state:        z.string(),
  lat:          z.number(),
  lng:          z.number(),
  created_at:   z.string(),
});

export const createSavedAddressSchema = savedAddressSchema.omit({ id: true, created_at: true });
export const updateSavedAddressSchema = createSavedAddressSchema.partial();

export type SavedAddress = z.infer<typeof savedAddressSchema>;
export type CreateSavedAddress = z.infer<typeof createSavedAddressSchema>;
```

### `recent-location.ts`

```ts
export const recentLocationSchema = z.object({
  id:           z.string().uuid(),
  address_text: z.string().min(1),
  city:         z.string(),
  state:        z.string(),
  lat:          z.number(),
  lng:          z.number(),
  used_at:      z.string(),
});

export const upsertRecentLocationSchema = recentLocationSchema.omit({ id: true, used_at: true });

export type RecentLocation = z.infer<typeof recentLocationSchema>;
export type UpsertRecentLocation = z.infer<typeof upsertRecentLocationSchema>;
```

---

## API Routes (`apps/api/src/routes/addresses.ts`)

All routes behind `requireAuth`. Ownership enforced at the service layer via explicit `WHERE user_id = ?` in every Drizzle query. RLS is defense-in-depth only.

| Method | Path                        | Description                              |
|--------|-----------------------------|------------------------------------------|
| GET    | /api/v1/addresses           | List user's saved addresses              |
| GET    | /api/v1/addresses/recent    | List user's recent locations (last 5)    |
| GET    | /api/v1/addresses/:id       | Get single saved address (edit screen)   |
| POST   | /api/v1/addresses           | Create saved address (enforces 25-cap)   |
| POST   | /api/v1/addresses/recent    | Upsert a recent location                 |
| PUT    | /api/v1/addresses/:id       | Update saved address                     |
| DELETE | /api/v1/addresses/:id       | Delete saved address                     |

**Route ordering:** `/addresses/recent` must be registered before `/addresses/:id` in Hono to prevent `recent` being matched as an ID.

**Cap enforcement (POST /addresses):** Count existing rows. If `count >= 25` return `400 LIMIT_REACHED`.

**Upsert (POST /addresses/recent):** Match on `(user_id, address_text)`. If exists: update `used_at` + coords. If new: insert, then delete oldest row if user count > 5. Always return `200`.

---

## Service Layer

### `apps/api/src/services/address-service.ts`

Pattern mirrors `profile-service`: Drizzle `db` client, explicit `WHERE userId = ?` on every query.

```ts
listAddresses(userId)           // ORDER BY created_at ASC
getAddress(userId, id)          // WHERE id = ? AND user_id = ?
createAddress(userId, input)    // count check → insert
updateAddress(userId, id, input)
deleteAddress(userId, id)
```

### `apps/api/src/services/recent-location-service.ts`

```ts
listRecent(userId)              // ORDER BY used_at DESC LIMIT 5
upsertRecent(userId, input)     // match (user_id, address_text) → update or insert + evict oldest
```

The upsert + eviction runs in a single Drizzle transaction.

---

## `reverseGeocode()` Update (`packages/mobile-shared/src/maps/locationiq.ts`)

Change return type from `string | null` to `LocationSuggestion | null`. LocationIQ's reverse endpoint already returns the same shape as autocomplete — structured `address.city` and `address.state` fields are available without string parsing.

Callers in `pickup.tsx` and `dropoff.tsx` change `setSelectedAddress(address)` → `setSelectedAddress(address.display_name)`.

---

## Mobile-Shared API Client (`packages/mobile-shared/src/api/addresses.ts`)

```ts
export function createAddressesClient(token: string) {
  const client = createAuthClient(token);
  return {
    // Saved addresses
    list:         ()                                       => client.get<SavedAddress[]>('/addresses'),
    get:          (id: string)                             => client.get<SavedAddress>(`/addresses/${id}`),
    create:       (body: CreateSavedAddress)               => client.post<SavedAddress>('/addresses', body),
    update:       (id: string, body: Partial<CreateSavedAddress>) =>
                                                              client.put<SavedAddress>(`/addresses/${id}`, body),
    remove:       (id: string)                             => client.delete<void>(`/addresses/${id}`),
    // Recent locations
    listRecent:   ()                                       => client.get<RecentLocation[]>('/addresses/recent'),
    upsertRecent: (body: UpsertRecentLocation)             => client.post<void>('/addresses/recent', body),
  };
}
```

Export from `packages/mobile-shared/src/index.ts`. Screens get the token via `useAuthStore((s) => s.session?.access_token)`.

---

## Mobile Screens

### `profile/addresses.tsx` (existing — replace shell)
- Fetch saved addresses on mount
- Render list: label + truncated `address_text`
- Hide "Add New Address" and show cap message when `addresses.length >= 25`
- Swipe-to-delete with `Alert.alert` confirmation
- Tap address → push `profile/address-edit?id=<id>`
- Empty state: prompt to add home and office

### `profile/address-edit.tsx` (new)
- Reads optional `id` from `useLocalSearchParams()` — edit mode vs. create mode
- **Edit mode:** fetches `GET /addresses/:id` on mount to pre-populate form
- **Create mode:** blank form
- Label: preset chips ("Home", "Office", "Work", "Other") + free-text input for custom label
- Address search: reuses `searchAddress()` with same debounce pattern as pickup/dropoff
- Mapbox map: full-screen with overlay search, tap-to-drop
- `city`/`state` extracted from `suggestion.address.city/.state` (autocomplete) or `result.address.city/.state` (reverse geocode after pin drop)
- Save → POST or PUT → pop back to addresses list

### `booking/pickup.tsx` + `booking/dropoff.tsx` (additive changes)

**Chip row (quick-select):**
- Fetch saved addresses on mount
- Horizontal `FlatList` of chips above the search bar
- Chip tap: sets `selectedCoords` + `selectedAddress` from stored data, flies camera — no API call
- Hidden when no saved addresses

**Search panel (Recent + Saved sections):**
- When search bar is focused and `query.length < 3`: show two stacked sections in the suggestions list
  - **Recent** — from `listRecent()`, up to 5 rows, most recent first; hidden if empty
  - **Saved** — from the already-fetched saved addresses list; hidden if empty
- When `query.length >= 3`: LocationIQ autocomplete results only (existing behaviour)
- Tapping a Recent or Saved result calls `selectSuggestion()` with the same shape — pre-fills map and address card

**Inline save nudge:**
- After any address selection, the address confirmation card shows preset label chips: "Home", "Office", "Work", "Other"
- Hidden when `savedAddresses.length >= 25`
- Chip tap: `POST /addresses` → brief "Saved as [label] ✓" confirmation; silent on failure

**Recent location write:**
- `handleConfirm` in both screens calls `upsertRecent()` with the confirmed address — fire-and-forget, no await, no error handling

---

## State Management

No new Zustand store. All address data is fetched per-screen into local `useState`. The booking screens fetch both saved addresses and recent locations on mount — both are used across the chip row, search panel, and save nudge.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Saved address list fetch fails | Inline error with retry; chip row hidden in booking context |
| Recent locations fetch fails | Recent section silently absent from search panel |
| Save address fails (inline nudge) | Silent — booking flow not interrupted |
| Save address fails (edit screen) | `Alert.alert`, form stays open |
| Delete fails | `Alert.alert`, item stays in list |
| Cap reached (`LIMIT_REACHED`) | Edit screen shows error; booking screen never reaches API (chips hidden) |
| `upsertRecent` fails | Silent — fire-and-forget |
