# Requirements Document

Feature: Booking Recipient Contact Info

> **Status:** Implemented and shipped.
>
> **Scope clarification (address vs. recipient):** This spec covers per-delivery
> *recipient contact* (name, phone, notes) captured on the booking Recipient step
> and snapshotted onto the `deliveries` row. It does **not** cover saved *places*
> (pickup/dropoff locations) — that is the separate `mobile-address-lookup` spec.
>
> **Related specs:**
> - `mobile-address-lookup` — reusable saved *places* / recent locations.
> - `saved-recipients-contact-book` — makes recipient *contacts* reusable (a
>   contact book) on top of this spec. Recipient details captured here remain a
>   per-delivery snapshot; the contact book is a convenience source only and never
>   mutates historical deliveries.

## Introduction
Drivers need to know who to contact at the pickup and dropoff locations. Currently the delivery record stores addresses but no contact details — a driver arriving at a dropoff has no way to reach the recipient. This feature adds a dedicated booking step to collect recipient contact info and optional delivery notes.

## Glossary

- **Recipient Details:** The name, phone, and optional delivery notes for the person receiving a delivery.
- **Delivery Snapshot:** Recipient details copied onto the `deliveries` row at booking time; the immutable record for that delivery.
- **Sender Phone:** The authenticated sender's phone, populated server-side from `users.phone` (not collected in the booking flow).

## Requirements

The following user stories and acceptance criteria define the feature.

### User Stories

### Recipient Step — Booking Flow

**WHEN** a user completes the Package step  
**THEN** they proceed to a new "Recipient" step (Step 4 of 7)

**WHEN** a user is on the Recipient step  
**THEN** they must enter the recipient's name and phone number  
**AND** they can optionally enter delivery notes for the driver

**WHEN** a user submits the Recipient step  
**THEN** the form validates that recipient name is not empty  
**AND** recipient phone matches a valid Nigerian format (+234 or 0 prefix, 11 digits)  
**AND** delivery notes do not exceed 200 characters  
**AND** on success they proceed to the Carriers step

**WHEN** a user navigates back from Carriers to Recipient  
**THEN** the form is pre-populated with their previously entered values

### Review Screen

**WHEN** a user reaches the Review step  
**THEN** they see a "Recipient" card showing the recipient name, phone, and delivery notes (if any)

### Delivery Record

**WHEN** a delivery is created  
**THEN** `recipient_name` and `recipient_phone` are persisted on the delivery record  
**AND** `delivery_notes` is persisted if provided  
**AND** `sender_phone` is populated server-side from the authenticated user's profile (not asked in the booking flow)

### Driver Visibility

**WHEN** a driver views a delivery assignment  
**THEN** they can see the recipient name, recipient phone, and any delivery notes  
(Driver app implementation is out of scope for this spec — DB and API changes are the prerequisite)

---

## Acceptance Criteria

- Recipient name: required, 2–100 characters
- Recipient phone: required, valid Nigerian mobile format (validated with a regex: `^(\+234|0)[789][01]\d{8}$`)
- Delivery notes: optional, max 200 characters
- Sender phone: not collected in the booking flow — populated server-side from `users.phone`
- The booking flow step count updates from 6 to 7
- Back-navigation from Carriers pre-fills the Recipient form
- The Review screen shows recipient details
- Deliveries created before this feature (missing contact info) are not broken — `recipient_name`, `recipient_phone` are non-nullable but will be added with a migration default for existing rows
