-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."carrier_member_role" AS ENUM('carrier_admin', 'carrier_driver');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'matched', 'picked_up', 'in_transit', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."name_change_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('new_user_signup', 'delivery_issue', 'carrier_verification_request', 'carrier_verified', 'dispute_opened', 'driver_verification_request', 'system_alert');--> statement-breakpoint
CREATE TYPE "public"."package_category" AS ENUM('document', 'parcel', 'fragile', 'heavy', 'food');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'driver', 'carrier_driver', 'carrier_admin', 'support_agent', 'surewaka_admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('motorcycle', 'car', 'van', 'truck');--> statement-breakpoint
CREATE TYPE "public"."waitlist_user_type" AS ENUM('sender', 'business', 'driver');--> statement-breakpoint
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
	CONSTRAINT "carriers_slug_unique" UNIQUE("slug")
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "user_saved_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "recent_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"driver_id" uuid,
	"carrier_id" uuid,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
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
	"sender_phone" text
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
ALTER TABLE "carrier_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_change_requests" ADD CONSTRAINT "name_change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_change_requests" ADD CONSTRAINT "name_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_addresses" ADD CONSTRAINT "user_saved_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_locations" ADD CONSTRAINT "recent_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_members" ADD CONSTRAINT "carrier_members_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_members" ADD CONSTRAINT "carrier_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_members" ADD CONSTRAINT "carrier_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_audit_log" ADD CONSTRAINT "role_audit_log_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_audit_log" ADD CONSTRAINT "role_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_created_at" ON "waitlist_signups" USING btree ("created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_email" ON "waitlist_signups" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_email_trgm" ON "waitlist_signups" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_full_name_trgm" ON "waitlist_signups" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_source" ON "waitlist_signups" USING btree ("source" text_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_signups_user_type_created_at" ON "waitlist_signups" USING btree ("user_type" timestamp_ops,"created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "idx_name_change_requests_status" ON "name_change_requests" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_name_change_requests_user" ON "name_change_requests" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_cleanup" ON "notifications" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id" bool_ops,"is_read" uuid_ops) WHERE (is_read = false);--> statement-breakpoint
CREATE INDEX "idx_user_roles_user_active" ON "user_roles" USING btree ("user_id" bool_ops,"is_active" bool_ops) WHERE (is_active = true);--> statement-breakpoint
CREATE POLICY "service_role_manage_users" ON "users" AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'service_role'::text));--> statement-breakpoint
CREATE POLICY "support_read_users" ON "users" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "users_update_own_profile" ON "users" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "users manage own addresses" ON "user_saved_addresses" AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "users manage own recent locations" ON "recent_locations" AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "notifications_delete_service" ON "notifications" AS PERMISSIVE FOR DELETE TO public USING (true);--> statement-breakpoint
CREATE POLICY "notifications_insert_service" ON "notifications" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "notifications_select_own" ON "notifications" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "notifications_update_own" ON "notifications" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "carrier_admin_drivers" ON "carrier_members" AS PERMISSIVE FOR ALL TO public USING (((carrier_id IN ( SELECT cm.carrier_id
   FROM carrier_members cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.role = 'carrier_admin'::carrier_member_role) AND (cm.is_active = true)))) OR has_role('surewaka_admin'::text))) WITH CHECK (((carrier_id IN ( SELECT cm.carrier_id
   FROM carrier_members cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.role = 'carrier_admin'::carrier_member_role) AND (cm.is_active = true)))) OR has_role('surewaka_admin'::text)));
*/