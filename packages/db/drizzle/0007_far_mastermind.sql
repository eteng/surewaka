ALTER TYPE "public"."transaction_type" ADD VALUE 'payout_reversal';--> statement-breakpoint
ALTER TABLE "payout_requests" DROP CONSTRAINT "payout_requests_status_check";--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'reversed'::text]));