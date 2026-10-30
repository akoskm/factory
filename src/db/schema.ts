import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  repoUrl: text("repo_url").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  definitionPath: text("definition_path").notNull().default("agents"),
  maxConcurrentRuns: integer("max_concurrent_runs").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const secrets = pgTable("secrets", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("secrets_project_key").on(t.projectId, t.key),
]);

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("github"),
  name: text("name").notNull(),
  config: jsonb("config").$type<{
    owner: string;
    repo: string;
    label: string;
  }>().notNull(),
  secretId: uuid("secret_id").references(() => secrets.id),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  agentType: text("agent_type").notNull(),
  description: text("description").notNull().default(""),
  harness: text("harness").notNull().default("cursor"),
  model: text("model").notNull().default("composer-2"),
  spawnableBy: jsonb("spawnable_by").$type<string[]>().notNull().default([]),
  waitForReview: boolean("wait_for_review").notNull().default(false),
  instructions: text("instructions").notNull().default(""),
  idleTimeoutMinutes: integer("idle_timeout_minutes").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("agents_project_name").on(t.projectId, t.name),
]);

export const workItems = pgTable("work_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  url: text("url").notNull().default(""),
  status: text("status").notNull().default("queued"),
  currentAgent: text("current_agent"),
  workflowId: text("workflow_id").notNull(),
  branch: text("branch"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  waitingForReview: boolean("waiting_for_review").notNull().default(false),
  kickoffAt: timestamp("kickoff_at", { withTimezone: true }).defaultNow().notNull(),
  prOpenedAt: timestamp("pr_opened_at", { withTimezone: true }),
  firstReviewAt: timestamp("first_review_at", { withTimezone: true }),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  uniqueIndex("work_items_source_external").on(t.sourceId, t.externalId),
]);

export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  harness: text("harness").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("running"),
  transcript: text("transcript").notNull().default(""),
  decision: jsonb("decision").$type<{
    action: "spawn" | "complete" | "fail";
    agent?: string;
    note?: string;
  } | null>(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const suggestions = pgTable("suggestions", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  prUrl: text("pr_url"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
