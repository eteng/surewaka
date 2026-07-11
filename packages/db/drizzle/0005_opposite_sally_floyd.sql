CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"sw_lat" real,
	"sw_lng" real,
	"ne_lat" real,
	"ne_lng" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_name_city_country_unique" UNIQUE("name","city","country")
);
--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" DROP CONSTRAINT "carrier_sla_overrides_carrier_origin_dest_unique";--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD COLUMN "pickup_zone_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD COLUMN "dropoff_zone_id" uuid;--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" ADD COLUMN "origin_zone_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" ADD COLUMN "destination_zone_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_zones_city_active" ON "zones" USING btree ("city","is_active");--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_pickup_zone_id_zones_id_fk" FOREIGN KEY ("pickup_zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_legs" ADD CONSTRAINT "delivery_legs_dropoff_zone_id_zones_id_fk" FOREIGN KEY ("dropoff_zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" ADD CONSTRAINT "carrier_sla_overrides_origin_zone_id_zones_id_fk" FOREIGN KEY ("origin_zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" ADD CONSTRAINT "carrier_sla_overrides_destination_zone_id_zones_id_fk" FOREIGN KEY ("destination_zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delivery_legs_pickup_zone_id" ON "delivery_legs" USING btree ("pickup_zone_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_legs_dropoff_zone_id" ON "delivery_legs" USING btree ("dropoff_zone_id");--> statement-breakpoint
ALTER TABLE "delivery_legs" DROP COLUMN "pickup_zone";--> statement-breakpoint
ALTER TABLE "delivery_legs" DROP COLUMN "dropoff_zone";--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" DROP COLUMN "origin_zone";--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" DROP COLUMN "destination_zone";--> statement-breakpoint
ALTER TABLE "carrier_sla_overrides" ADD CONSTRAINT "carrier_sla_overrides_carrier_zones_unique" UNIQUE("carrier_id","origin_zone_id","destination_zone_id");