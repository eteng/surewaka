-- =============================================================================
-- Baseline Schema
-- Creates foundational tables that existed on remote before migration tracking.
-- This migration captures the initial state needed for all subsequent migrations.
-- =============================================================================

-- =============================================================================
-- Extensions
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- Enums
-- =============================================================================
CREATE TYPE user_role AS ENUM ('customer', 'driver');
CREATE TYPE vehicle_type AS ENUM ('motorcycle', 'car', 'van', 'truck');
CREATE TYPE delivery_status AS ENUM ('draft', 'pending', 'accepted', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered', 'cancelled', 'failed', 'returned');
CREATE TYPE package_category AS ENUM ('document', 'parcel', 'fragile', 'heavy', 'food');
CREATE TYPE waitlist_user_type AS ENUM ('sender', 'business', 'driver');

-- =============================================================================
-- Users table
-- =============================================================================
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  phone text NOT NULL,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Carriers table
-- =============================================================================
CREATE TABLE carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text NOT NULL,
  rating real DEFAULT 0,
  delivery_count real DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Drivers table
-- =============================================================================
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  vehicle_type vehicle_type NOT NULL,
  license_plate text NOT NULL,
  vehicle_model text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  rating real DEFAULT 0,
  available boolean NOT NULL DEFAULT false,
  lat real,
  lng real,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Deliveries table
-- =============================================================================
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES drivers(id),
  carrier_id uuid REFERENCES carriers(id),
  status delivery_status NOT NULL DEFAULT 'draft',
  pickup_address text NOT NULL,
  pickup_city text NOT NULL,
  pickup_lat real NOT NULL,
  pickup_lng real NOT NULL,
  dropoff_address text NOT NULL,
  dropoff_city text NOT NULL,
  dropoff_lat real NOT NULL,
  dropoff_lng real NOT NULL,
  package_description text NOT NULL,
  package_weight real NOT NULL,
  package_category package_category NOT NULL,
  price real,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Waitlist signups table
-- =============================================================================
CREATE TABLE waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  user_type waitlist_user_type NOT NULL,
  source text DEFAULT 'home',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
