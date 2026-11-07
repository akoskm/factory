ALTER TABLE "work_items" ADD COLUMN "phase" text DEFAULT 'step' NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "integrate_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "revision_loops" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "learn_error" text;
