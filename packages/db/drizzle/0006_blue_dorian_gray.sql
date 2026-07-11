CREATE TABLE "carrier_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"old_base_price_kobo" integer,
	"new_base_price_kobo" integer NOT NULL,
	"changed_by" uuid,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_leg_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"carrier_id" uuid,
	"line_items" jsonb NOT NULL,
	"total_kobo" integer NOT NULL,
	"distance_km" real,
	"package_weight_kg" real,
	"expires_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_rate_kobo" integer DEFAULT 200000 NOT NULL,
	"per_kg_rate_kobo" integer DEFAULT 20000 NOT NULL,
	"per_km_rate_kobo" integer DEFAULT 15000 NOT NULL,
	"carrier_commission_rate_pct" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"tax_rate_pct" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"min_price_kobo" integer DEFAULT 50000 NOT NULL,
	"weight_correction_approval_window_min" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_discrepancy_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"reported_leg_id" uuid NOT NULL,
	"declared_weight_kg" real NOT NULL,
	"reported_weight_kg" real NOT NULL,
	"delta_kobo" integer NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"approval_deadline" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"wallet_transaction_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_type_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"multiplier" numeric(4, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_invoice_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"invoiced_amount_kobo" integer NOT NULL,
	"quoted_carrier_total_kobo" integer NOT NULL,
	"variance_kobo" integer NOT NULL,
	"entered_by" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_invoice_reconciliations_carrier_period_unique" UNIQUE("carrier_id","period_start","period_end")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "price_kobo" integer;--> statement-breakpoint
ALTER TABLE "carrier_rate_history" ADD CONSTRAINT "carrier_rate_history_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rate_history" ADD CONSTRAINT "carrier_rate_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_delivery_leg_id_delivery_legs_id_fk" FOREIGN KEY ("delivery_leg_id") REFERENCES "public"."delivery_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_discrepancy_corrections" ADD CONSTRAINT "weight_discrepancy_corrections_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_discrepancy_corrections" ADD CONSTRAINT "weight_discrepancy_corrections_reported_leg_id_delivery_legs_id_fk" FOREIGN KEY ("reported_leg_id") REFERENCES "public"."delivery_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_invoice_reconciliations" ADD CONSTRAINT "carrier_invoice_reconciliations_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_invoice_reconciliations" ADD CONSTRAINT "carrier_invoice_reconciliations_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quotes_leg_active" ON "quotes" USING btree ("delivery_leg_id") WHERE superseded_at IS NULL AND confirmed_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_quotes_delivery" ON "quotes" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_weight_corrections_pending" ON "weight_discrepancy_corrections" USING btree ("approval_deadline") WHERE status = 'pending_approval';--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_type_rates_vehicle_type_unique" ON "vehicle_type_rates" USING btree ("vehicle_type");--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "price";