ALTER TABLE "work_items" ALTER COLUMN "status" SET DEFAULT 'listed';--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "queued_at" timestamp with time zone;
