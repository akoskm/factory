CREATE TABLE "work_item_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"cursor_agent_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_chat_sessions_work_item_id_unique" UNIQUE("work_item_id")
);
--> statement-breakpoint
CREATE TABLE "work_item_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"path" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_chat_sessions" ADD CONSTRAINT "work_item_chat_sessions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_item_messages" ADD CONSTRAINT "work_item_messages_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_item_messages" ADD CONSTRAINT "work_item_messages_session_id_work_item_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."work_item_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_item_messages" ADD CONSTRAINT "work_item_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_item_attachments" ADD CONSTRAINT "work_item_attachments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_item_attachments" ADD CONSTRAINT "work_item_attachments_message_id_work_item_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."work_item_messages"("id") ON DELETE cascade ON UPDATE no action;
