import { pgTable, foreignKey, uuid, text, boolean, real, timestamp, unique, index, pgPolicy, numeric, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const carrierMemberRole = pgEnum("carrier_member_role", ['carrier_admin', 'carrier_driver'])
export const deliveryStatus = pgEnum("delivery_status", ['pending', 'matched', 'picked_up', 'in_transit', 'delivered', 'cancelled'])
export const nameChangeStatus = pgEnum("name_change_status", ['pending', 'approved', 'rejected'])
export const notificationType = pgEnum("notification_type", ['new_user_signup', 'delivery_issue', 'carrier_verification_request', 'carrier_verified', 'dispute_opened', 'driver_verification_request', 'system_alert'])
export const packageCategory = pgEnum("package_category", ['document', 'parcel', 'fragile', 'heavy', 'food'])
export const userRole = pgEnum("user_role", ['customer', 'driver', 'carrier_driver', 'carrier_admin', 'support_agent', 'surewaka_admin'])
export const vehicleType = pgEnum("vehicle_type", ['motorcycle', 'car', 'van', 'truck'])
export const waitlistUserType = pgEnum("waitlist_user_type", ['sender', 'business', 'driver'])


export const drivers = pgTable("drivers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	vehicleType: vehicleType("vehicle_type").notNull(),
	licensePlate: text("license_plate").notNull(),
	vehicleModel: text("vehicle_model").notNull(),
	verified: boolean().default(false).notNull(),
	rating: real().default(0),
	available: boolean().default(false).notNull(),
	lat: real(),
	lng: real(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "drivers_user_id_users_id_fk"
		}),
]);

export const carriers = pgTable("carriers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	contactEmail: text("contact_email").notNull(),
	rating: real().default(0),
	deliveryCount: real("delivery_count").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	slug: text().notNull(),
	logoUrl: text("logo_url"),
	isVerified: boolean("is_verified").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	verifiedAt: timestamp("verified_at", { mode: 'string' }),
	verifiedBy: uuid("verified_by"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.verifiedBy],
			foreignColumns: [users.id],
			name: "carriers_verified_by_users_id_fk"
		}),
	unique("carriers_slug_unique").on(table.slug),
]);

export const waitlistSignups = pgTable("waitlist_signups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fullName: text("full_name").notNull(),
	email: text().notNull(),
	userType: waitlistUserType("user_type").notNull(),
	source: text().default('home'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_waitlist_signups_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_waitlist_signups_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_waitlist_signups_email_trgm").using("gin", table.email.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_waitlist_signups_full_name_trgm").using("gin", table.fullName.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_waitlist_signups_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("idx_waitlist_signups_user_type_created_at").using("btree", table.userType.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	unique("waitlist_signups_email_unique").on(table.email),
]);

export const nameChangeRequests = pgTable("name_change_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	currentName: text("current_name").notNull(),
	requestedName: text("requested_name").notNull(),
	reason: text().notNull(),
	status: nameChangeStatus().default('pending').notNull(),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_name_change_requests_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_name_change_requests_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reviewedBy],
			foreignColumns: [users.id],
			name: "name_change_requests_reviewed_by_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "name_change_requests_user_id_fkey"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text(),
	phone: text().notNull(),
	name: text().notNull(),
	role: userRole().default('customer').notNull(),
	verified: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	avatarUrl: text("avatar_url"),
	notificationEmail: boolean("notification_email").default(true).notNull(),
	notificationSms: boolean("notification_sms").default(true).notNull(),
}, (table) => [
	unique("users_email_unique").on(table.email),
	pgPolicy("service_role_manage_users", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("support_read_users", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("users_update_own_profile", { as: "permissive", for: "update", to: ["public"] }),
]);

export const userSavedAddresses = pgTable("user_saved_addresses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	label: text().notNull(),
	addressText: text("address_text").notNull(),
	city: text().notNull(),
	state: text().notNull(),
	lat: numeric({ precision: 10, scale:  7 }).notNull(),
	lng: numeric({ precision: 10, scale:  7 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_saved_addresses_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("users manage own addresses", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.uid() = user_id)`, withCheck: sql`(auth.uid() = user_id)`  }),
]);

export const recentLocations = pgTable("recent_locations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	addressText: text("address_text").notNull(),
	city: text().notNull(),
	state: text().notNull(),
	lat: numeric({ precision: 10, scale:  7 }).notNull(),
	lng: numeric({ precision: 10, scale:  7 }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "recent_locations_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("users manage own recent locations", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.uid() = user_id)`, withCheck: sql`(auth.uid() = user_id)`  }),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: notificationType().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	resourceLink: text("resource_link"),
	isRead: boolean("is_read").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_cleanup").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_notifications_user_created").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notifications_user_unread").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isRead.asc().nullsLast().op("uuid_ops")).where(sql`(is_read = false)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("notifications_delete_service", { as: "permissive", for: "delete", to: ["public"], using: sql`true` }),
	pgPolicy("notifications_insert_service", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("notifications_select_own", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("notifications_update_own", { as: "permissive", for: "update", to: ["public"] }),
]);

export const deliveries = pgTable("deliveries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	driverId: uuid("driver_id"),
	carrierId: uuid("carrier_id"),
	status: deliveryStatus().default('pending').notNull(),
	pickupAddress: text("pickup_address").notNull(),
	pickupCity: text("pickup_city").notNull(),
	pickupLat: real("pickup_lat").notNull(),
	pickupLng: real("pickup_lng").notNull(),
	dropoffAddress: text("dropoff_address").notNull(),
	dropoffCity: text("dropoff_city").notNull(),
	dropoffLat: real("dropoff_lat").notNull(),
	dropoffLng: real("dropoff_lng").notNull(),
	packageDescription: text("package_description").notNull(),
	packageWeight: real("package_weight").notNull(),
	packageCategory: packageCategory("package_category").notNull(),
	price: real(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	recipientName: text("recipient_name").notNull(),
	recipientPhone: text("recipient_phone").notNull(),
	deliveryNotes: text("delivery_notes"),
	senderPhone: text("sender_phone"),
}, (table) => [
	foreignKey({
			columns: [table.carrierId],
			foreignColumns: [carriers.id],
			name: "deliveries_carrier_id_carriers_id_fk"
		}),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "deliveries_customer_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.driverId],
			foreignColumns: [drivers.id],
			name: "deliveries_driver_id_drivers_id_fk"
		}),
]);

export const carrierMembers = pgTable("carrier_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	carrierId: uuid("carrier_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: carrierMemberRole().notNull(),
	invitedBy: uuid("invited_by"),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
	leftAt: timestamp("left_at", { mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.carrierId],
			foreignColumns: [carriers.id],
			name: "carrier_members_carrier_id_carriers_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [users.id],
			name: "carrier_members_invited_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "carrier_members_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("uq_carrier_members_active").on(table.carrierId, table.userId),
	pgPolicy("carrier_admin_drivers", { as: "permissive", for: "all", to: ["public"], using: sql`((carrier_id IN ( SELECT cm.carrier_id
   FROM carrier_members cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.role = 'carrier_admin'::carrier_member_role) AND (cm.is_active = true)))) OR has_role('surewaka_admin'::text))`, withCheck: sql`((carrier_id IN ( SELECT cm.carrier_id
   FROM carrier_members cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.role = 'carrier_admin'::carrier_member_role) AND (cm.is_active = true)))) OR has_role('surewaka_admin'::text))`  }),
]);

export const userRoles = pgTable("user_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: userRole().notNull(),
	scopeType: text("scope_type"),
	scopeId: uuid("scope_id"),
	assignedBy: uuid("assigned_by"),
	assignedAt: timestamp("assigned_at", { mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	index("idx_user_roles_user_active").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")).where(sql`(is_active = true)`),
	foreignKey({
			columns: [table.assignedBy],
			foreignColumns: [users.id],
			name: "user_roles_assigned_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_roles_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("uq_user_roles_active").on(table.userId, table.role, table.scopeId),
]);

export const roleAuditLog = pgTable("role_audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: userRole().notNull(),
	action: text().notNull(),
	scopeType: text("scope_type"),
	scopeId: uuid("scope_id"),
	performedBy: uuid("performed_by"),
	reason: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.performedBy],
			foreignColumns: [users.id],
			name: "role_audit_log_performed_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "role_audit_log_user_id_users_id_fk"
		}),
]);
