# Requirements — Mobile Address Lookup

## Overview
Users need to save frequently-used addresses and quickly select them during the booking flow, with recent locations surfaced automatically — reducing friction for repeat senders.

---

## User Stories

### Saved Addresses — Profile

**WHEN** a user opens Profile → Saved Addresses  
**THEN** they see a list of their saved addresses (label + street preview)  
**AND** empty state shows a prompt to add addresses

**WHEN** a user has 25 saved addresses  
**THEN** the "Add New Address" button is hidden and a message reads "You've reached the maximum of 25 saved addresses"

**WHEN** a user taps "Add New Address" or taps an existing address  
**THEN** they are taken to the address edit screen

**WHEN** a user is on the address edit screen  
**THEN** they can search for an address using the LocationIQ autocomplete  
**AND** they can drop a pin on a Mapbox map to set the exact location  
**AND** they can enter or select a label ("Home", "Office", "Work", or custom free text)  
**AND** tapping Save persists the address via the API

**WHEN** a user swipes left on a saved address  
**THEN** a Delete action appears; confirming removes the address permanently

**WHEN** a user has no addresses saved  
**THEN** the profile addresses screen shows an empty state with a prompt to add home and office addresses

### Saved Addresses — Booking Flow (Quick-Select Chips)

**WHEN** a user reaches the Pickup or Dropoff screen and has at least one saved address  
**THEN** a horizontal chip row shows their saved addresses above the search bar

**WHEN** a user taps a saved address chip  
**THEN** the map camera flies to the saved address coordinates  
**AND** the pin is dropped at the saved location  
**AND** the address confirmation card appears at the bottom of the screen  
**AND** the user still taps "Confirm Pickup" / "Confirm Dropoff" to proceed

**WHEN** a user has no saved addresses  
**THEN** the chip row is not shown

### Saved Addresses — Inline Save from Booking Flow

**WHEN** a user selects any address on the Pickup or Dropoff screen (via autocomplete or pin drop)  
**AND** the user has fewer than 25 saved addresses  
**THEN** the address confirmation card shows preset label chips: "Home", "Office", "Work", "Other"

**WHEN** a user taps a label chip  
**THEN** the address is saved immediately via the API  
**AND** a brief confirmation appears ("Saved as Home ✓")  
**AND** the user can continue to "Confirm Pickup" / "Confirm Dropoff" without interruption

**WHEN** a user has 25 saved addresses  
**THEN** the save chips are not shown in the address confirmation card

**WHEN** a user dismisses or ignores the save chips  
**THEN** the booking flow continues normally with no address saved

### Recent Locations — Search Panel

**WHEN** a user taps the search bar on the Pickup or Dropoff screen  
**AND** has not yet typed anything (or fewer than 3 characters)  
**THEN** the search panel shows two sections:
- **Recent** — up to 5 of the user's most recently confirmed addresses, ordered by most recent first
- **Saved** — the user's saved addresses (label + street preview)

**WHEN** a user types 3 or more characters into the search bar  
**THEN** the Recent and Saved sections are replaced by LocationIQ autocomplete results (existing behaviour)

**WHEN** a user taps a Recent or Saved result in the search panel  
**THEN** the map pre-fills exactly as if they had selected an autocomplete suggestion (same flow)

**WHEN** a user confirms a Pickup or Dropoff address  
**THEN** that address is automatically recorded as a recent location (fire-and-forget, transparent to the user)

**WHEN** the same address is confirmed again  
**THEN** it moves to the top of the Recent list (upsert by address text, update timestamp)

**WHEN** the user has no prior confirmed addresses  
**THEN** the Recent section is not shown; only Saved addresses are shown (or empty state if none)

---

## Acceptance Criteria

- Saved addresses persist across sessions (stored in DB, not local state)
- Each saved address stores: label, address_text, city, state, lat, lng
- Each recent location stores: address_text, city, state, lat, lng, used_at
- A user cannot see or modify another user's addresses or recent locations (RLS + explicit userId filter)
- A user may not save more than 25 addresses; the API returns `LIMIT_REACHED` if exceeded
- Recent locations are capped at 5 per user; oldest is evicted when a 6th is added
- Labels are not unique — a user can have two addresses both labelled "Home"
- Address search uses the existing LocationIQ integration (Nigeria-scoped)
- Map pin interaction on edit screen mirrors the existing pickup/dropoff UX
- Chip selection in booking pre-fills the map and address card; user still confirms manually
- Inline save chips are preset only ("Home", "Office", "Work", "Other") — no keyboard required
- Inline save chips always appear after address selection regardless of whether the address is already saved, unless the user is at the 25-address cap
- Recent location write on confirm is fire-and-forget — failure does not block the booking flow
- Delete saved address requires confirmation before calling the API
