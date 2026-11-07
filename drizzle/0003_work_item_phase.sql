ALTER TABLE "work_items" ADD COLUMN "phase" text DEFAULT 'step' NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "integrate_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "revision_loops" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "learn_error" text;
--> statement-breakpoint
UPDATE "work_items" SET "phase" = 'on_complete' WHERE "status" = 'merged';
--> statement-breakpoint
UPDATE "work_items"
SET "status" = 'needs_user', "phase" = 'ship'
WHERE "status" = 'waiting_review'
  AND "pr_number" IS NOT NULL
  AND COALESCE("error", '') ~* 'activity task failed|merge conflict|not mergeable|behind';
--> statement-breakpoint
UPDATE "work_items"
SET "phase" = 'ship'
WHERE "status" = 'failed'
  AND "pr_number" IS NOT NULL
  AND COALESCE("error", '') ~* 'activity task failed|merge conflict|not mergeable|behind';
