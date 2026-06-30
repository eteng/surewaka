CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"device_id" text NOT NULL,
	"platform" text NOT NULL,
	"app" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_expo_push_token_unique" UNIQUE("expo_push_token"),
	CONSTRAINT "push_tokens_platform_check" CHECK (platform IN ('ios', 'android')),
	CONSTRAINT "push_tokens_app_check" CHECK (app IN ('customer', 'driver'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_push_tokens_user_active" ON "push_tokens" USING btree ("user_id","is_active") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_push_tokens_user_app_active" ON "push_tokens" USING btree ("user_id","app","is_active") WHERE is_active = true;