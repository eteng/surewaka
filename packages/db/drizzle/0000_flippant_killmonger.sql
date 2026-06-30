CREATE TYPE "public"."carrier_application_status" AS ENUM('pending', 'under_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."carrier_member_action" AS ENUM('invited', 'joined', 'role_changed', 'suspended', 'reactivated', 'removed');--> statement-breakpoint
CREATE TYPE "public"."carrier_member_role" AS ENUM('carrier_admin', 'carrier_driver', 'carrier_staff');--> statement-breakpoint
CREATE TYPE "public"."customer_tier" AS ENUM('power', 'regular', 'new', 'dormant');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('draft', 'pending', 'accepted', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered', 'cancelled', 'failed', 'returned');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('held', 'released', 'refunded', 'disputed', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."name_change_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_user_signup', 'delivery_issue', 'carrier_verification_request', 'carrier_verified', 'dispute_opened', 'driver_verification_request', 'system_alert');--> statement-breakpoint
CREATE TYPE "public"."package_category" AS ENUM('document', 'parcel', 'fragile', 'heavy', 'food');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('fund', 'escrow_hold', 'escrow_release', 'refund', 'payout', 'commission', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'driver', 'carrier_driver', 'carrier_admin', 'support_agent', 'surewaka_admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('motorcycle', 'car', 'van', 'truck');--> statement-breakpoint
CREATE TYPE "public"."waitlist_user_type" AS ENUM('sender', 'business', 'driver');--> statement-breakpoint
CREATE TYPE "public"."wallet_status" AS ENUM('active', 'frozen', 'closed');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"avatar_url" text,
	"notification_email" boolean DEFAULT true NOT NULL,
	"notification_sms" boolean DEFAULT true NOT NULL,
	"gender" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_gender_check" CHECK (gender = ANY (ARRAY['woman'::text, 'man'::text, 'prefer_not_to_disclose'::text]))
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"scope_type" text,
	"scope_id" uuid,
	"assigned_by" uuid,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_user_roles_active" UNIQUE("user_id","role","scope_id")
);
--> statement-breakpoint
CREATE TABLE "role_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"action" text NOT NULL,
	"scope_type" text,
	"scope_id" uuid,
	"performed_by" uuid,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "carrier_member_role" NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_carrier_members_active" UNIQUE("carrier_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_email" text NOT NULL,
	"rating" real DEFAULT 0,
	"delivery_count" real DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp,
	"verified_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"driver_vetting_enabled" boolean DEFAULT false NOT NULL,
	"application_id" uuid,
	CONSTRAINT "carriers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "carrier_application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" "carrier_application_status",
	"to_status" "carrier_application_status" NOT NULL,
	"performed_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"cac_number" text,
	"fleet_size" integer,
	"service_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status" "carrier_application_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"review_notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_member_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"target_user_id" uuid,
	"action" "carrier_member_action" NOT NULL,
	"role" "carrier_member_role" NOT NULL,
	"performed_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_member_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"phone" text,
	"email" text,
	"role" "carrier_member_role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_or_email_required" CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"license_plate" text NOT NULL,
	"vehicle_model" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"rating" real DEFAULT 0,
	"available" boolean DEFAULT false NOT NULL,
	"lat" real,
	"lng" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"driver_id" uuid,
	"carrier_id" uuid,
	"status" "delivery_status" DEFAULT 'draft' NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_city" text NOT NULL,
	"pickup_lat" real NOT NULL,
	"pickup_lng" real NOT NULL,
	"dropoff_address" text NOT NULL,
	"dropoff_city" text NOT NULL,
	"dropoff_lat" real NOT NULL,
	"dropoff_lng" real NOT NULL,
	"package_description" text NOT NULL,
	"package_weight" real NOT NULL,
	"package_category" "package_category" NOT NULL,
	"price" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"delivery_notes" text,
	"sender_phone" text,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"escrow_hold_id" uuid,
	"amount_paid" bigint,
	CONSTRAINT "deliveries_amount_paid_check" CHECK (amount_paid > 0),
	CONSTRAINT "deliveries_payment_status_check" CHECK (payment_status = ANY (ARRAY['unpaid'::text, 'escrowed'::text, 'released'::text, 'refunded'::text]))
);
--> statement-breakpoint
CREATE TABLE "escrow_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"sender_wallet_id" uuid NOT NULL,
	"driver_wallet_id" uuid,
	"total_amount" bigint NOT NULL,
	"commission_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"commission_amount" bigint DEFAULT 0 NOT NULL,
	"driver_amount" bigint DEFAULT 0 NOT NULL,
	"status" "escrow_status" DEFAULT 'held' NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escrow_holds_commission_amount_check" CHECK (commission_amount >= 0),
	CONSTRAINT "escrow_holds_driver_amount_check" CHECK (driver_amount >= 0),
	CONSTRAINT "escrow_holds_total_amount_check" CHECK (total_amount > 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reference" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_reference_key" UNIQUE("reference"),
	CONSTRAINT "wallet_transactions_amount_check" CHECK (amount <> 0),
	CONSTRAINT "wallet_transactions_balance_after_check" CHECK (balance_after >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" "wallet_status" DEFAULT 'active' NOT NULL,
	"dva_bank" text,
	"dva_account_no" text,
	"dva_customer_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_currency_key" UNIQUE("user_id","currency"),
	CONSTRAINT "wallets_balance_check" CHECK (balance >= 0)
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"paystack_transfer_code" text,
	"paystack_recipient_code" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_requests_amount_check" CHECK (amount > 0),
	CONSTRAINT "payout_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "recent_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address_text" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_saved_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address_text" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "name_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"current_name" text NOT NULL,
	"requested_name" text NOT NULL,
	"reason" text NOT NULL,
	"status" "name_change_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"resource_link" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" "customer_tier" NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"total_spent" bigint DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp,
	"primary_city" text,
	"health_score" smallint DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_segments_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"user_type" "waitlist_user_type" NOT NULL,
	"source" text DEFAULT 'home',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_audit_log" ADD CONSTRAINT "role_audit_log_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_audit_log" ADD CONSTRAINT "role_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_members" ADD CONSTRAINT "carrier_members_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_members" ADD CONSTRAINT "carrier_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_members" ADD CONSTRAINT "carrier_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_application_events" ADD CONSTRAINT "carrier_application_events_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."carrier_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_application_events" ADD CONSTRAINT "carrier_application_events_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_applications" ADD CONSTRAINT "carrier_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_member_events" ADD CONSTRAINT "carrier_member_events_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_member_events" ADD CONSTRAINT "carrier_member_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_member_events" ADD CONSTRAINT "carrier_member_events_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_member_invitations" ADD CONSTRAINT "carrier_member_invitations_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_member_invitations" ADD CONSTRAINT "carrier_member_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_holds" ADD CONSTRAINT "escrow_holds_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_holds" ADD CONSTRAINT "escrow_holds_driver_wallet_id_fkey" FOREIGN KEY ("driver_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_holds" ADD CONSTRAINT "escrow_holds_sender_wallet_id_fkey" FOREIGN KEY ("sender_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_locations" ADD CONSTRAINT "recent_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_addresses" ADD CONSTRAINT "user_saved_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_change_requests" ADD CONSTRAINT "name_change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_change_requests" ADD CONSTRAINT "name_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_segments" ADD CONSTRAINT "customer_segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_roles_user_active" ON "user_roles" USING btree ("user_id","is_active") WHERE (is_active = true);--> statement-breakpoint
CREATE INDEX "idx_carrier_application_events_application" ON "carrier_application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_carrier_applications_status" ON "carrier_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_carrier_applications_created_at" ON "carrier_applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_carrier_member_events_carrier" ON "carrier_member_events" USING btree ("carrier_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_carrier_member_invitations_phone" ON "carrier_member_invitations" USING btree ("phone") WHERE phone IS NOT NULL AND accepted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_carrier_member_invitations_email" ON "carrier_member_invitations" USING btree ("email") WHERE email IS NOT NULL AND accepted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_deliveries_payment_status" ON "deliveries" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "idx_escrow_holds_delivery_id" ON "escrow_holds" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_holds_sender_wallet" ON "escrow_holds" USING btree ("sender_wallet_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_holds_status" ON "escrow_holds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wallet_transactions_created_at" ON "wallet_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_wallet_transactions_reference" ON "wallet_transactions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "idx_wallet_transactions_type" ON "wallet_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_wallet_transactions_wallet_created" ON "wallet_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_wallet_transactions_wallet_id" ON "wallet_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_wallets_user_id" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payout_requests_status" ON "payout_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payout_requests_wallet_id" ON "payout_requests" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_name_change_requests_status" ON "name_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_name_change_requests_user" ON "name_change_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_cleanup" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","is_read") WHERE (is_read = false);--> statement-breakpoint
CREATE INDEX "idx_customer_segments_tier" ON "customer_segments" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_customer_segments_city" ON "customer_segments" USING btree ("primary_city");--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_created_at" ON "waitlist_signups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_email" ON "waitlist_signups" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_source" ON "waitlist_signups" USING btree ("source");