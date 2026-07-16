CREATE TABLE "platform_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_ledger_source_category_type_key" UNIQUE("source_id","category","type"),
	CONSTRAINT "platform_ledger_category_check" CHECK (category IN ('revenue', 'expense')),
	CONSTRAINT "platform_ledger_amount_check" CHECK (amount_kobo > 0),
	CONSTRAINT "platform_ledger_type_check" CHECK (type IN ('commission', 'withdrawal_fee', 'paystack_transfer', 'paystack_collection', 'commission_reversal'))
);
--> statement-breakpoint
CREATE TABLE "cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"amount_usd" numeric(12, 4) NOT NULL,
	"usd_to_ngn_rate" numeric(10, 2) NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"snapshot_date" date NOT NULL,
	"raw_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_snapshots_provider_date_key" UNIQUE("provider","snapshot_date"),
	CONSTRAINT "cost_snapshots_provider_check" CHECK (provider IN ('vercel', 'fly', 'neon', 'clerk', 'ably')),
	CONSTRAINT "cost_snapshots_amount_check" CHECK (amount_kobo >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_platform_ledger_occurred_at" ON "platform_ledger" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_platform_ledger_category_type" ON "platform_ledger" USING btree ("category","type");--> statement-breakpoint
CREATE INDEX "idx_cost_snapshots_snapshot_date" ON "cost_snapshots" USING btree ("snapshot_date");