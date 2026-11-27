CREATE TABLE IF NOT EXISTS "work_item_proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "filename" text NOT NULL,
  "mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
  "title" text,
  "path" text NOT NULL,
  "size" integer DEFAULT 0 NOT NULL,
  "sha" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_proofs_item_filename" ON "work_item_proofs" ("work_item_id","filename");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proof_setup_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "setup_pr_number" integer,
  "setup_pr_url" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proof_setup_locks_project" ON "proof_setup_locks" ("project_id");
