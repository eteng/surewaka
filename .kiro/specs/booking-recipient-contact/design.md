# Design — Booking Recipient Contact Info

## Overview

Per-delivery recipient contact capture (name, phone, notes) via a new booking
step, snapshotted onto the `deliveries` row so drivers can reach the recipient.

## Architecture

Additive changes only. New booking step + new fields on the `deliveries` table. Follows the same patterns as the existing `package.tsx` step (react-hook-form + Zod resolver + booking store).

## Data Models

### DB Schema Changes (`deliveries` table)

```sql
alter table deliveries
  add column recipient_name  text not null default '',
  add column recipient_phone text not null default '',
  add column delivery_notes  text,
  add column sender_phone    text;

-- Remove defaults after migration (defaults only needed for existing rows)
alter table deliveries
  alter column recipient_name  drop default,
  alter column recipient_phone drop default;
```

Existing rows get empty strings for `recipient_name` and `recipient_phone` — acceptable for historical data. `sender_phone` and `delivery_notes` remain nullable.

### Drizzle schema update (`packages/db/src/schema/deliveries.ts`)

> Note: the schema is one-file-per-table under `packages/db/src/schema/`, exported
> via `packages/db/src/schema/index.ts` — not a single monolithic `schema.ts`.
> These fields are added to the `deliveries` table in `schema/deliveries.ts`.

```ts
// Add to the deliveries pgTable definition:
recipientName:  text('recipient_name').notNull(),
recipientPhone: text('recipient_phone').notNull(),
deliveryNotes:  text('delivery_notes'),
senderPhone:    text('sender_phone'),
```

---

## Zod Validators (`packages/shared/src/validators/`)

### New file: `recipient-details.ts`

```ts
const NIGERIAN_PHONE_RE = /^(\+234|0)[789][01]\d{8}$/;

export const recipientDetailsSchema = z.object({
  recipientName:  z.string().min(2).max(100),
  recipientPhone: z.string().regex(NIGERIAN_PHONE_RE, 'Enter a valid Nigerian mobile number'),
  deliveryNotes:  z.string().max(200).optional(),
});

export type RecipientDetails = z.infer<typeof recipientDetailsSchema>;
```

Export from `packages/shared/src/index.ts`.

### Update delivery creation schema

Add `recipientDetails: recipientDetailsSchema` to the existing delivery creation Zod schema (wherever it lives in `@surewaka/shared`).

---

## Booking Store (`packages/mobile-shared/src/store/booking-store.ts`)

Add `recipientDetails` alongside the existing `packageDetails`:

```ts
recipientDetails: Partial<RecipientDetails> | null;
setRecipientDetails: (details: Partial<RecipientDetails>) => void;
```

Include in the `reset()` action.

---

## Components and Interfaces

### New Screen: `apps/mobile-customer/app/booking/recipient.tsx`

Follows the exact same pattern as `package.tsx`:
- `useForm` + `zodResolver(recipientDetailsSchema)`
- Default values from `useBookingStore((s) => s.recipientDetails)`
- On submit: `setRecipientDetails(data)` → `setStep(3)` → `router.push('/booking/carriers')`

**Fields:**
- `recipientName` — text input, "Who should the driver ask for?"
- `recipientPhone` — phone input, numeric keyboard, placeholder "08012345678"
- `deliveryNotes` — multiline text input, optional, placeholder "Any instructions for the driver? (optional)"

Phone field shows a `+234` prefix hint. Validation error message: "Enter a valid Nigerian mobile number".

---

## Booking Layout Update (`apps/mobile-customer/app/booking/_layout.tsx`)

```ts
// Before
const steps = ['Pickup', 'Drop-off', 'Package', 'Carriers', 'Review', 'Confirmed'];

// After
const steps = ['Pickup', 'Drop-off', 'Package', 'Recipient', 'Carriers', 'Review', 'Confirmed'];
```

Add new `Stack.Screen`:
```ts
<Stack.Screen
  name="recipient"
  options={{ title: `Step 4 of ${steps.length}: Recipient` }}
/>
```

Shift existing step numbers: Carriers → Step 5, Review → Step 6. Confirmed stays as-is.

---

## Package Screen Update (`apps/mobile-customer/app/booking/package.tsx`)

Change the `onSubmit` navigation target:
```ts
// Before: router.push('/booking/carriers')
// After:  router.push('/booking/recipient')
```

Also update `setStep(3)` to remain 3 (recipient is still step index 3 in the zero-indexed store, carriers becomes 4).

---

## Review Screen Update (`apps/mobile-customer/app/booking/review.tsx`)

Add a `recipientDetails` card between the Package card and the Service card:

```tsx
<View className="bg-gray-50 rounded-xl p-4 mb-4">
  <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">Recipient</Text>
  <Text className="text-base text-gray-900">{recipientDetails?.recipientName ?? '—'}</Text>
  <Text className="text-sm text-gray-500">{recipientDetails?.recipientPhone ?? '—'}</Text>
  {recipientDetails?.deliveryNotes && (
    <Text className="text-sm text-gray-400 mt-1 italic">"{recipientDetails.deliveryNotes}"</Text>
  )}
</View>
```

Include `recipientDetails` in the `POST /deliveries` body under `recipientDetails`.

---

## API — Delivery Creation (`apps/api/src/routes/deliveries.ts`)

Update `POST /deliveries` to:
1. Accept and validate `recipientDetails` in the request body
2. Look up `sender_phone` from the `users` table using the authenticated `user.id`
3. Persist all new fields on the delivery record

```ts
// Server-side sender phone lookup
const [user] = await db
  .select({ phone: users.phone })
  .from(users)
  .where(eq(users.id, userId));

// Insert with new fields
await db.insert(deliveries).values({
  ...existingFields,
  recipientName:  body.recipientDetails.recipientName,
  recipientPhone: body.recipientDetails.recipientPhone,
  deliveryNotes:  body.recipientDetails.deliveryNotes ?? null,
  senderPhone:    user?.phone ?? null,
});
```

---

## State Management

No new Zustand store. `recipientDetails` is added to the existing `useBookingStore` alongside `packageDetails`. The same reset/back-navigation pattern applies.

---

## Error Handling

- Phone validation: inline field error via react-hook-form (same pattern as package.tsx)
- API failure on delivery creation: existing `Alert.alert` in review.tsx handles it
- Missing `sender_phone` on user profile: stored as `null`, not a blocking error

## Correctness Properties

Retained retroactively for this shipped spec. Key invariants enforced by the implementation:

### Property 1: Snapshot immutability

Recipient name/phone/notes are copied onto the `deliveries` row at creation and are independent of any external source thereafter.

**Validates: Requirements 1.1**

### Property 2: Phone validity

A delivery is never created with a `recipientPhone` that fails the Nigerian mobile pattern `^(\+234|0)[789][01]\d{8}$`.

**Validates: Requirements 1.2**

### Property 3: Sender phone provenance

`sender_phone` is always sourced server-side from `users.phone` for the authenticated user, never from the request body.

**Validates: Requirements 1.3**

## Testing Strategy

Retained retroactively for this shipped spec. Coverage: Zod validation unit tests for `recipientDetailsSchema` (name length, phone regex, notes max); API test for server-side `sender_phone` lookup on `POST /deliveries`; manual verification of the recipient step, back-navigation pre-fill, and review card on device.
