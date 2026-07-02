CREATE TABLE "delivery_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"leg_number" smallint NOT NULL,
	"leg_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_lat" real NOT NULL,
	"pickup_lng" real NOT NULL,
	"pickup_zone" text,
	"dropoff_address" text NOT NULL,
	"dropoff_lat" real NOT NULL,
	"dropoff_lng" real NOT NULL,
	"dropoff_zone" text,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"system_eta_at" timestamp with time zone,
	"driver_eta_at" timestamp with time zone,
	"sla_hours" real,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_legs_delivery_id_leg_number_unique" UNIQUE("delivery_id","leg_number"),
	CONSTRAINT "delivery_legs_leg_number_check" CHECK (leg_number BETWEEN 1 AND 10),
	CONSTRAINT "delivery_legs_leg_type_check" CHECK (leg_type = ANY (ARRAY['first_mile'::text, 'intercity'::text, 'last_mile'::text])),
	CONSTRAINT "delivery_legs_actor_type_check" CHECK (actor_type = ANY (ARRAY['driver'::text, 'carrier'::text]))
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"leg_id" uuid,
	"from_status" "delivery_status",
	"to_status" "delivery_status" NOT NULL,
	"triggered_by" uuid,
	"failure_cause" text,
	"failure_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_events_failure_cause_check" CHECK (failure_cause = ANY (ARRAY['driver'::text, 'carrier'::text, 'route_traffic'::text, 'system'::text]))
);
--> statement-breakpoint
CREATE TABLE "delivery_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"driver_id" uuid,
	"customer_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_ratings_delivery_id_customer_id_unique" UNIQUE("delivery_id","customer_id"),
	CONSTRAINT "delivery_ratings_rating_check" CHECK (rating BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "driver_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"delivery_id" uuid,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_sla_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"origin_zone" text NOT NULL,
	"destination_zone" text NOT NULL,
	"sla_hours" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_sla_overrides_carrier_origin_dest_unique" UNIQUE("carrier_id","origin_zone","destination_zone"),
	CONSTRAINT "carrier_sla_overrides_sla_hours_check" CHECK (sla_hours > 0)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "system_eta_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "driver_eta_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_leg_id_delivery_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."delivery_legs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" ADD CONSTRAINT "carrier_sla_overrides_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delivery_legs_delivery_id" ON "delivery_legs" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_legs_actor_id" ON "delivery_legs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_events_delivery_id" ON "delivery_events" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_events_leg_id" ON "delivery_events" USING btree ("leg_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_events_created_at" ON "delivery_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_delivery_ratings_driver_id" ON "delivery_ratings" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_driver_locations_driver_recent" ON "driver_locations" USING btree ("driver_id","recorded_at");