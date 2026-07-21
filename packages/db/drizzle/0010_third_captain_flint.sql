ALTER TYPE "public"."delivery_status" ADD VALUE 'pending_routing' BEFORE 'accepted';--> statement-breakpoint
ALTER TYPE "public"."delivery_status" ADD VALUE 'routing_failed' BEFORE 'accepted';--> statement-breakpoint
CREATE TABLE "carrier_parks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_parks_carrier_id_name_unique" UNIQUE("carrier_id","name")
);
--> statement-breakpoint
CREATE TABLE "carrier_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"origin_park_id" uuid NOT NULL,
	"destination_park_id" uuid NOT NULL,
	"base_price_kobo" integer NOT NULL,
	"estimated_transit_hrs" real NOT NULL,
	"max_weight_kg" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_routes_carrier_id_origin_destination_unique" UNIQUE("carrier_id","origin_park_id","destination_park_id"),
	CONSTRAINT "carrier_routes_different_parks_check" CHECK (origin_park_id != destination_park_id)
);
--> statement-breakpoint
CREATE TABLE "carrier_route_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_route_id" uuid NOT NULL,
	"hour" smallint NOT NULL,
	"minute" smallint DEFAULT 0 NOT NULL,
	"days_of_week" smallint[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_route_schedules_hour_check" CHECK (hour >= 0 AND hour <= 23),
	CONSTRAINT "carrier_route_schedules_minute_check" CHECK (minute >= 0 AND minute <= 59)
);
--> statement-breakpoint
ALTER TABLE "delivery_legs" DROP CONSTRAINT "delivery_legs_leg_type_check";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "delivery_mode" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "cancellation_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_parks" ADD CONSTRAINT "carrier_parks_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_routes" ADD CONSTRAINT "carrier_routes_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_routes" ADD CONSTRAINT "carrier_routes_origin_park_id_carrier_parks_id_fk" FOREIGN KEY ("origin_park_id") REFERENCES "public"."carrier_parks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_routes" ADD CONSTRAINT "carrier_routes_destination_park_id_carrier_parks_id_fk" FOREIGN KEY ("destination_park_id") REFERENCES "public"."carrier_parks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_route_schedules" ADD CONSTRAINT "carrier_route_schedules_carrier_route_id_carrier_routes_id_fk" FOREIGN KEY ("carrier_route_id") REFERENCES "public"."carrier_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_carrier_parks_city_active" ON "carrier_parks" USING btree ("city") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_carrier_routes_origin_destination_active" ON "carrier_routes" USING btree ("origin_park_id","destination_park_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_carrier_route_schedules_route_active" ON "carrier_route_schedules" USING btree ("carrier_route_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_delivery_legs_delivery_id_active" ON "delivery_legs" USING btree ("delivery_id") WHERE is_active = true;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivery_mode_check" CHECK (delivery_mode IS NULL OR delivery_mode = ANY (ARRAY['on_demand'::text, 'carrier_direct'::text, 'surewaka_way'::text]));--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_leg_type_check" CHECK (leg_type = ANY (ARRAY['first_mile'::text, 'intercity'::text, 'transfer'::text, 'last_mile'::text]));