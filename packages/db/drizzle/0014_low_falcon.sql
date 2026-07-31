CREATE TABLE "coverage_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"h3_index" text NOT NULL,
	"demand_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_gaps_h3_index_unique" UNIQUE("h3_index")
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "h3_index" text;--> statement-breakpoint
CREATE INDEX "idx_coverage_gaps_demand" ON "coverage_gaps" USING btree ("demand_count") WHERE demand_count > 0;--> statement-breakpoint
CREATE INDEX "idx_coverage_gaps_h3" ON "coverage_gaps" USING btree ("h3_index");--> statement-breakpoint
CREATE INDEX "idx_drivers_h3_available" ON "drivers" USING btree ("h3_index") WHERE available = true AND h3_index IS NOT NULL;