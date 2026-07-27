CREATE TYPE "public"."delivery_offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "delivery_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"score" real NOT NULL,
	"distance_km" real NOT NULL,
	"status" "delivery_offer_status" DEFAULT 'pending' NOT NULL,
	"offered_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "acceptance_rate" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "completion_rate" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "total_offers_received" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "total_offers_accepted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "total_deliveries_completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "last_job_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delivery_offers_delivery_id" ON "delivery_offers" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_offers_driver_id" ON "delivery_offers" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_offers_status" ON "delivery_offers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_deliveries_active_driver" ON "deliveries" USING btree ("driver_id") WHERE driver_id IS NOT NULL AND status IN ('accepted', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff');