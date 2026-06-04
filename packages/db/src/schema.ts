import { pgTable, index, unique, pgPolicy, uuid, text, timestamp, foreignKey, numeric, check, boolean, real, bigint, jsonb, type AnyPgColumn, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const carrierMemberRole = pgEnum("carrier_member_role", ['carrier_admin', 'carrier_driver'])
export const deliveryStatus = pgEnum("delivery_status", ['draft', 'pending', 'accepted', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered', 'cancelled', 'failed', 'returned'])
export const escrowStatus = pgEnum("escrow_status", ['held', 'released', 'refunded', 'disputed', 'partially_refunded'])
export const nameChangeStatus = pgEnum("name_change_status", ['pending', 'approved', 'rejected'])
export const notificationType = pgEnum("notification_type", ['new_user_signup', 'delivery_issue', 'carrier_verification_request', 'carrier_verified', 'dispute_opened', 'driver_verification_request', 'system_alert'])
export const packageCategory = pgEnum("package_category", ['document', 'parcel', 'fragile', 'heavy', 'food'])
export const transactionType = pgEnum("transaction_type", ['fund', 'escrow_hold', 'escrow_release', 'refund', 'payout', 'commission', 'adjustment'])
export const userRole = pgEnum("user_role", ['customer', 'driver', 'carrier_driver', 'carrier_admin', 'support_agent', 'surewaka_admin'])
export const vehicleType = pgEnum("vehicle_type", ['motorcycle', 'car', 'van', 'truck'])
export const waitlistUserType = pgEnum("waitlist_user_type", ['sender', 'business', 'driver'])
export const walletStatus = pgEnum("wallet_status", ['active', 'frozen', 'closed'])


export const waitlistSignups = pgTable("waitlist_signups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fullName: text("full_name").notNull(),
	email: text().notNull(),
	userType: waitlistUserType("user_type").notNull(),
	source: text().default('home'),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
	index("idx_waitlist_signups_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_waitlist_signups_email").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("idx_waitlist_signups_email_trgm").using("gin", table.email.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_waitlist_signups_full_name_trgm").using("gin", table.fullName.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_waitlist_signups_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("idx_waitlist_signups_user_type_created_at").using("btree", table.userType.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	unique("waitlist_signups_email_unique").on(table.email),
	pgPolicy("service_role_manage_waitlist", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("admin_read_waitlist", { as: "permissive", for: "select", to: ["public"] }),
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
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
	usedAt: timestamp("used_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "recent_locations_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("users manage own recent locations", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.uid() = user_id)`, withCheck: sql`(auth.uid() = user_id)`  }),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text(),
	phone: text().notNull(),
	name: text().notNull(),
	role: userRole().default('customer').notNull(),
	verified: boolean().default(false).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
	avatarUrl: text("avatar_url"),
	notificationEmail: boolean("notification_email").default(true).notNull(),
	notificationSms: boolean("notification_sms").default(true).notNull(),
	gender: text(),
}, (table) => [
	unique("users_email_unique").on(table.email),
	pgPolicy("support_read_users", { as: "permissive", for: "select", to: ["public"], using: sql`((id = auth.uid()) OR has_role('support_agent'::text) OR has_role('surewaka_admin'::text))` }),
	pgPolicy("service_role_manage_users", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("users_update_own_profile", { as: "permissive", for: "update", to: ["public"] }),
	check("users_gender_check", sql`gender = ANY (ARRAY['woman'::text, 'man'::text, 'prefer_not_to_disclose'::text])`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: notificationType().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	resourceLink: text("resource_link"),
	isRead: boolean("is_read").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_cleanup").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_notifications_user_created").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notifications_user_unread").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isRead.asc().nullsLast().op("uuid_ops")).where(sql`(is_read = false)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("notifications_insert_service", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`true`  }),
	pgPolicy("notifications_delete_service", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("notifications_select_own", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("notifications_update_own", { as: "permissive", for: "update", to: ["public"] }),
]);

export const carriers = pgTable("carriers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	contactEmail: text("contact_email").notNull(),
	rating: real().default(0),
	deliveryCount: real("delivery_count").default(0),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	slug: text().notNull(),
	logoUrl: text("logo_url"),
	isVerified: boolean("is_verified").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	verifiedAt: timestamp("verified_at"),
	verifiedBy: uuid("verified_by"),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.verifiedBy],
			foreignColumns: [users.id],
			name: "carriers_verified_by_users_id_fk"
		}),
	unique("carriers_slug_unique").on(table.slug),
	pgPolicy("service_role_manage_carriers", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("authenticated_read_active_carriers", { as: "permissive", for: "select", to: ["public"] }),
]);

export const userRoles = pgTable("user_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: userRole().notNull(),
	scopeType: text("scope_type"),
	scopeId: uuid("scope_id"),
	assignedBy: uuid("assigned_by"),
	assignedAt: timestamp("assigned_at").defaultNow().notNull(),
	revokedAt: timestamp("revoked_at"),
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
	pgPolicy("service_role_manage_user_roles", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("users_read_own_roles", { as: "permissive", for: "select", to: ["public"] }),
]);

export const carrierMembers = pgTable("carrier_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	carrierId: uuid("carrier_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: carrierMemberRole().notNull(),
	invitedBy: uuid("invited_by"),
	joinedAt: timestamp("joined_at").defaultNow().notNull(),
	leftAt: timestamp("left_at"),
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
	pgPolicy("service_role_manage_carrier_members", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("members_read_own_membership", { as: "permissive", for: "select", to: ["public"] }),
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
	createdAt: timestamp("created_at").defaultNow().notNull(),
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
	pgPolicy("service_role_manage_role_audit_log", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("admin_read_role_audit_log", { as: "permissive", for: "select", to: ["public"] }),
]);

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
	createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "drivers_user_id_users_id_fk"
		}),
	pgPolicy("service_role_manage_drivers", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("authenticated_read_available_drivers", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("drivers_manage_own_profile", { as: "permissive", for: "all", to: ["public"] }),
]);

export const nameChangeRequests = pgTable("name_change_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	currentName: text("current_name").notNull(),
	requestedName: text("requested_name").notNull(),
	reason: text().notNull(),
	status: nameChangeStatus().default('pending').notNull(),
	reviewedBy: uuid("reviewed_by"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
	pgPolicy("users_insert_own_name_change_requests", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(user_id = auth.uid())`  }),
	pgPolicy("users_read_own_name_change_requests", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("service_role_manage_name_change_requests", { as: "permissive", for: "all", to: ["public"] }),
]);

export const wallets = pgTable("wallets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	balance: bigint({ mode: "number" }).default(0).notNull(),
	currency: text().default('NGN').notNull(),
	status: walletStatus().default('active').notNull(),
	dvaBank: text("dva_bank"),
	dvaAccountNo: text("dva_account_no"),
	dvaCustomerCode: text("dva_customer_code"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	index("idx_wallets_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallets_user_id_fkey"
		}).onDelete("cascade"),
	unique("wallets_user_id_currency_key").on(table.userId, table.currency),
	pgPolicy("service_role_manage_wallets", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("users_read_own_wallet", { as: "permissive", for: "select", to: ["public"] }),
	check("wallets_balance_check", sql`balance >= 0`),
]);

export const walletTransactions = pgTable("wallet_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	walletId: uuid("wallet_id").notNull(),
	type: transactionType().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
	reference: text(),
	description: text(),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	index("idx_wallet_transactions_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_wallet_transactions_reference").using("btree", table.reference.asc().nullsLast().op("text_ops")),
	index("idx_wallet_transactions_type").using("btree", table.type.asc().nullsLast().op("enum_ops")),
	index("idx_wallet_transactions_wallet_created").using("btree", table.walletId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_wallet_transactions_wallet_id").using("btree", table.walletId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [wallets.id],
			name: "wallet_transactions_wallet_id_fkey"
		}),
	unique("wallet_transactions_reference_key").on(table.reference),
	pgPolicy("service_role_manage_wallet_transactions", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("users_read_own_wallet_transactions", { as: "permissive", for: "select", to: ["public"] }),
	check("wallet_transactions_amount_check", sql`amount <> 0`),
	check("wallet_transactions_balance_after_check", sql`balance_after >= 0`),
]);

export const escrowHolds = pgTable("escrow_holds", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	deliveryId: uuid("delivery_id").notNull(),
	senderWalletId: uuid("sender_wallet_id").notNull(),
	driverWalletId: uuid("driver_wallet_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
	commissionRate: numeric("commission_rate", { precision: 5, scale:  4 }).default('0.1500').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	commissionAmount: bigint("commission_amount", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	driverAmount: bigint("driver_amount", { mode: "number" }).default(0).notNull(),
	status: escrowStatus().default('held').notNull(),
	heldAt: timestamp("held_at", { withTimezone: true }).defaultNow().notNull(),
	releasedAt: timestamp("released_at", { withTimezone: true }),
	refundedAt: timestamp("refunded_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	index("idx_escrow_holds_delivery_id").using("btree", table.deliveryId.asc().nullsLast().op("uuid_ops")),
	index("idx_escrow_holds_sender_wallet").using("btree", table.senderWalletId.asc().nullsLast().op("uuid_ops")),
	index("idx_escrow_holds_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.deliveryId],
			foreignColumns: [deliveries.id],
			name: "escrow_holds_delivery_id_fkey"
		}),
	foreignKey({
			columns: [table.driverWalletId],
			foreignColumns: [wallets.id],
			name: "escrow_holds_driver_wallet_id_fkey"
		}),
	foreignKey({
			columns: [table.senderWalletId],
			foreignColumns: [wallets.id],
			name: "escrow_holds_sender_wallet_id_fkey"
		}),
	pgPolicy("service_role_manage_escrow_holds", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("senders_read_own_escrow", { as: "permissive", for: "select", to: ["public"] }),
	check("escrow_holds_commission_amount_check", sql`commission_amount >= 0`),
	check("escrow_holds_driver_amount_check", sql`driver_amount >= 0`),
	check("escrow_holds_total_amount_check", sql`total_amount > 0`),
]);

export const payoutRequests = pgTable("payout_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	walletId: uuid("wallet_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	bankCode: text("bank_code").notNull(),
	accountNumber: text("account_number").notNull(),
	accountName: text("account_name").notNull(),
	paystackTransferCode: text("paystack_transfer_code"),
	paystackRecipientCode: text("paystack_recipient_code"),
	status: text().default('pending').notNull(),
	failureReason: text("failure_reason"),
	processedAt: timestamp("processed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	index("idx_payout_requests_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_payout_requests_wallet_id").using("btree", table.walletId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [wallets.id],
			name: "payout_requests_wallet_id_fkey"
		}),
	pgPolicy("service_role_manage_payout_requests", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("users_read_own_payout_requests", { as: "permissive", for: "select", to: ["public"] }),
	check("payout_requests_amount_check", sql`amount > 0`),
	check("payout_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])`),
]);

export const deliveries = pgTable("deliveries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	driverId: uuid("driver_id"),
	carrierId: uuid("carrier_id"),
	status: deliveryStatus().default('draft').notNull(),
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
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
	recipientName: text("recipient_name").notNull(),
	recipientPhone: text("recipient_phone").notNull(),
	deliveryNotes: text("delivery_notes"),
	senderPhone: text("sender_phone"),
	paymentStatus: text("payment_status").default('unpaid').notNull(),
	escrowHoldId: uuid("escrow_hold_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amountPaid: bigint("amount_paid", { mode: "number" }),
}, (table) => [
	index("idx_deliveries_payment_status").using("btree", table.paymentStatus.asc().nullsLast().op("text_ops")),
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
	foreignKey({
			columns: [table.escrowHoldId],
			foreignColumns: [escrowHolds.id],
			name: "deliveries_escrow_hold_id_fkey"
		}),
	pgPolicy("service_role_manage_deliveries", { as: "permissive", for: "all", to: ["public"], using: sql`(auth.role() = 'service_role'::text)` }),
	pgPolicy("customers_read_own_deliveries", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("drivers_read_assigned_deliveries", { as: "permissive", for: "select", to: ["public"] }),
	check("deliveries_amount_paid_check", sql`amount_paid > 0`),
	check("deliveries_payment_status_check", sql`payment_status = ANY (ARRAY['unpaid'::text, 'escrowed'::text, 'released'::text, 'refunded'::text])`),
]);
