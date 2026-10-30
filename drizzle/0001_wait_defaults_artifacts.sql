ALTER TABLE "agents" ALTER COLUMN "wait_for_review" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "wait_for_review" DROP DEFAULT;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instance_agent_defaults" (
  "agent_name" text PRIMARY KEY NOT NULL,
  "wait_for_review" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "instance_agent_defaults" ("agent_name", "wait_for_review") VALUES
  ('foreman', false),
  ('triage', false),
  ('spec', false),
  ('implement', false),
  ('review', false),
  ('verify', false),
  ('monitor', false)
ON CONFLICT ("agent_name") DO NOTHING;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "run_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "work_item_artifacts" ADD CONSTRAINT "work_item_artifacts_work_item_id_work_items_id_fk"
    FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "work_item_artifacts" ADD CONSTRAINT "work_item_artifacts_run_id_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_artifacts_item_kind" ON "work_item_artifacts" ("work_item_id","kind");
