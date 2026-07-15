ALTER TABLE "payout_requests" ADD COLUMN "fee_kobo" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_settings" ADD COLUMN "withdrawal_fee_kobo" integer DEFAULT 10000 NOT NULL;