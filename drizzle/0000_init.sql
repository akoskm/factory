CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instance_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "repo_url" text NOT NULL,
  "default_branch" text DEFAULT 'main' NOT NULL,
  "max_concurrent_runs" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "ciphertext" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "secrets_project_key" ON "secrets" ("project_id","key");

CREATE TABLE IF NOT EXISTS "sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" text DEFAULT 'github' NOT NULL,
  "name" text NOT NULL,
  "config" jsonb NOT NULL,
  "secret_id" uuid REFERENCES "secrets"("id"),
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "work_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE cascade,
  "external_id" text NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "url" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "current_agent" text,
  "workflow_id" text NOT NULL,
  "branch" text,
  "pr_number" integer,
  "pr_url" text,
  "waiting_for_review" boolean DEFAULT false NOT NULL,
  "config_sha" text,
  "kickoff_at" timestamp with time zone DEFAULT now() NOT NULL,
  "pr_opened_at" timestamp with time zone,
  "first_review_at" timestamp with time zone,
  "merged_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_source_external" ON "work_items" ("source_id","external_id");

CREATE TABLE IF NOT EXISTS "runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "agent_name" text NOT NULL,
  "harness" text NOT NULL,
  "model" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "transcript" text DEFAULT '' NOT NULL,
  "decision" jsonb,
  "input_tokens" integer,
  "output_tokens" integer,
  "cost_usd" numeric(12, 6),
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "work_item_id" uuid REFERENCES "work_items"("id") ON DELETE set null,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE set null,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "pr_url" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "work_item_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_artifacts_item_kind" ON "work_item_artifacts" ("work_item_id","kind");
