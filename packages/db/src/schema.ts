import { pgTable, text, timestamp, boolean, real, pgEnum, uuid, numeric } from 'drizzle-orm/pg-core';

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
  recipientName: text('recipient_name').notNull(),
  recipientPhone: text('recipient_phone').notNull(),
  deliveryNotes: text('delivery_notes'),
  senderPhone: text('sender_phone'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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

export const notificationTypeEnum = pgEnum('notification_type', [
  'new_user_signup',
  'delivery_issue',
  'carrier_verification_request',
  'carrier_verified',
  'dispute_opened',
  'driver_verification_request',
  'system_alert',
]);

export const nameChangeStatusEnum = pgEnum('name_change_status', ['pending', 'approved', 'rejected']);

export const notifications = pgTable('notifications', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:         notificationTypeEnum('type').notNull(),
  title:        text('title').notNull(),
  message:      text('message').notNull(),
  resourceLink: text('resource_link'),
  isRead:       boolean('is_read').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nameChangeRequests = pgTable('name_change_requests', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  currentName:   text('current_name').notNull(),
  requestedName: text('requested_name').notNull(),
  reason:        text('reason').notNull(),
  status:        nameChangeStatusEnum('status').notNull().default('pending'),
  reviewedBy:    uuid('reviewed_by').references(() => users.id),
  reviewedAt:    timestamp('reviewed_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const carrierMemberRoleEnum = pgEnum('carrier_member_role', ['carrier_admin', 'carrier_driver']);

export const userRoles = pgTable('user_roles', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:       userRoleEnum('role').notNull(),
  scopeType:  text('scope_type'),
  scopeId:    uuid('scope_id'),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt:  timestamp('revoked_at', { withTimezone: true }),
  isActive:   boolean('is_active').notNull().default(true),
});

export const carrierMembers = pgTable('carrier_members', {
  id:         uuid('id').primaryKey().defaultRandom(),
  carrierId:  uuid('carrier_id').notNull().references(() => carriers.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:       carrierMemberRoleEnum('role').notNull(),
  invitedBy:  uuid('invited_by').references(() => users.id),
  joinedAt:   timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt:     timestamp('left_at', { withTimezone: true }),
  isActive:   boolean('is_active').notNull().default(true),
});

export const roleAuditLog = pgTable('role_audit_log', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id),
  role:        userRoleEnum('role').notNull(),
  action:      text('action').notNull(),
  scopeType:   text('scope_type'),
  scopeId:     uuid('scope_id'),
  performedBy: uuid('performed_by').references(() => users.id),
  reason:      text('reason'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
