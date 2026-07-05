CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid,
	"leg_id" uuid,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"original_severity" text,
	"message" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"ack_by" uuid,
	CONSTRAINT "alerts_severity_check" CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])),
	CONSTRAINT "alerts_original_severity_check" CHECK (original_severity IS NULL OR original_severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_silent_warning_min" integer DEFAULT 15 NOT NULL,
	"driver_silent_critical_min" integer DEFAULT 30 NOT NULL,
	"leg_overdue_warning_min" integer DEFAULT 30 NOT NULL,
	"leg_overdue_critical_min" integer DEFAULT 60 NOT NULL,
	"customer_update_gap_warning_min" integer DEFAULT 45 NOT NULL,
	"customer_update_gap_critical_min" integer DEFAULT 90 NOT NULL,
	"ontime_rate_warning_pct" integer DEFAULT 80 NOT NULL,
	"ontime_rate_critical_pct" integer DEFAULT 60 NOT NULL,
	"pumble_webhook_url" text,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"pumble_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" DROP CONSTRAINT "push_tokens_app_check";--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_leg_id_delivery_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."delivery_legs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_ack_by_users_id_fk" FOREIGN KEY ("ack_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alerts_unresolved" ON "alerts" USING btree ("fired_at" DESC NULLS LAST) WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_alerts_delivery_id" ON "alerts" USING btree ("delivery_id") WHERE delivery_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_app_check" CHECK (app IN ('customer', 'driver', 'admin'));