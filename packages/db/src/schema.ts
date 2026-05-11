import { pgTable, text, timestamp, boolean, real, pgEnum, uuid } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['customer', 'driver', 'carrier', 'admin']);
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'matched',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled',
]);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['motorcycle', 'car', 'van', 'truck']);
export const packageCategoryEnum = pgEnum('package_category', [
  'document',
  'parcel',
  'fragile',
  'heavy',
  'food',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('customer'),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
  licensePlate: text('license_plate').notNull(),
  vehicleModel: text('vehicle_model').notNull(),
  verified: boolean('verified').notNull().default(false),
  rating: real('rating').default(0),
  available: boolean('available').notNull().default(false),
  lat: real('lat'),
  lng: real('lng'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const carriers = pgTable('carriers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  contactEmail: text('contact_email').notNull(),
  verified: boolean('verified').notNull().default(false),
  rating: real('rating').default(0),
  deliveryCount: real('delivery_count').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const waitlistUserTypeEnum = pgEnum('waitlist_user_type', [
  'sender',
  'business',
  'driver',
]);

export const waitlistSignups = pgTable('waitlist_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  userType: waitlistUserTypeEnum('user_type').notNull(),
  source: text('source').default('home'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const deliveries = pgTable('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  carrierId: uuid('carrier_id').references(() => carriers.id),
  status: deliveryStatusEnum('status').notNull().default('pending'),
  pickupAddress: text('pickup_address').notNull(),
  pickupCity: text('pickup_city').notNull(),
  pickupLat: real('pickup_lat').notNull(),
  pickupLng: real('pickup_lng').notNull(),
  dropoffAddress: text('dropoff_address').notNull(),
  dropoffCity: text('dropoff_city').notNull(),
  dropoffLat: real('dropoff_lat').notNull(),
  dropoffLng: real('dropoff_lng').notNull(),
  packageDescription: text('package_description').notNull(),
  packageWeight: real('package_weight').notNull(),
  packageCategory: packageCategoryEnum('package_category').notNull(),
  price: real('price'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
