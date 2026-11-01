ALTER TABLE "suggestions" ADD COLUMN "summary" text;
ALTER TABLE "suggestions" ADD COLUMN "problem" text;
ALTER TABLE "suggestions" ADD COLUMN "solution" text;
ALTER TABLE "suggestions" ADD COLUMN "target_agent" text;
ALTER TABLE "suggestions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
UPDATE "suggestions" SET "updated_at" = "created_at";

CREATE TABLE "suggestion_runs" (
  "suggestion_id" uuid NOT NULL REFERENCES "suggestions"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL REFERENCES "runs"("id") ON DELETE cascade,
  CONSTRAINT "suggestion_runs_pkey" PRIMARY KEY ("suggestion_id", "run_id")
);
