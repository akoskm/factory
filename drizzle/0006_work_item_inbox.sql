CREATE TABLE "work_item_inbox_state" (
	"work_item_id" uuid PRIMARY KEY NOT NULL,
	"blocked_at" timestamp with time zone NOT NULL,
	"snoozed_until" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_inbox_state" ADD CONSTRAINT "work_item_inbox_state_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "work_item_inbox_state" ("work_item_id", "blocked_at", "updated_at")
SELECT "id", COALESCE("kickoff_at", now()), now()
FROM "work_items"
WHERE "status" = 'needs_user';
