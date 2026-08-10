ALTER TABLE "coverage_gaps" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coverage_gaps" ADD COLUMN "nearest_park_km" real;--> statement-breakpoint
ALTER TABLE "coverage_gaps" ADD COLUMN "nearest_driver_km" real;--> statement-breakpoint
CREATE INDEX "idx_coverage_gaps_resolved" ON "coverage_gaps" USING btree ("resolved_at");