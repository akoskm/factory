import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/index.js";
import {
  agents,
  projects,
  runs,
  secrets,
  sources,
  suggestions,
  workItems,
} from "../db/schema.js";
import { encryptSecret } from "../crypto/secrets.js";
import { syncAgentsForProject } from "../services/seed-agents.js";
import { signalReview } from "../temporal/client.js";
import { isAuthed, requireAuth, setSessionCookie } from "./auth.js";
import { projectMetrics } from "./metrics.js";

const app = new Hono();
app.use("*", requireAuth);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/login", async (c) => {
  const body = await c.req.json<{ password?: string }>();
  if (body.password !== (process.env.ADMIN_PASSWORD ?? "admin")) {
    return c.json({ error: "invalid password" }, 401);
  }
  setSessionCookie(c, body.password);
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, "factory_session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", (c) => c.json({ authenticated: isAuthed(c) }));

app.get("/api/projects", async (c) => {
  const rows = await db.select().from(projects).orderBy(projects.name);
  return c.json(rows);
});

app.post("/api/projects", async (c) => {
  const body = await c.req.json<{
    name: string;
    slug: string;
    repoUrl: string;
    defaultBranch?: string;
  }>();
  const [project] = await db
    .insert(projects)
    .values({
      name: body.name,
      slug: body.slug,
      repoUrl: body.repoUrl,
      defaultBranch: body.defaultBranch ?? "main",
    })
    .returning();
  await syncAgentsForProject(project.id);
  return c.json(project, 201);
});

app.get("/api/projects/:id", async (c) => {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, c.req.param("id")))
    .limit(1);
  if (!project) return c.json({ error: "not found" }, 404);
  return c.json(project);
});

app.get("/api/projects/:id/metrics", async (c) => {
  const days = Number(c.req.query("days") ?? 7);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return c.json(await projectMetrics(c.req.param("id"), from, to));
});

app.get("/api/projects/:id/work-items", async (c) => {
  const rows = await db
    .select()
    .from(workItems)
    .where(eq(workItems.projectId, c.req.param("id")))
    .orderBy(desc(workItems.kickoffAt));
  return c.json(rows);
});

app.get("/api/work-items/:id", async (c) => {
  const [item] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, c.req.param("id")))
    .limit(1);
  if (!item) return c.json({ error: "not found" }, 404);
  const itemRuns = await db
    .select()
    .from(runs)
    .where(eq(runs.workItemId, item.id))
    .orderBy(desc(runs.startedAt));
  return c.json({ ...item, runs: itemRuns });
});

app.post("/api/work-items/:id/review", async (c) => {
  const body = await c.req.json<{ decision: "approve" | "request_changes"; note?: string }>();
  const [item] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, c.req.param("id")))
    .limit(1);
  if (!item) return c.json({ error: "not found" }, 404);
  await signalReview(item.workflowId, body.decision, body.note);
  return c.json({ ok: true });
});

app.get("/api/projects/:id/runs", async (c) => {
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.projectId, c.req.param("id")))
    .orderBy(desc(runs.startedAt))
    .limit(200);
  return c.json(rows);
});

app.get("/api/projects/:id/agents", async (c) => {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.projectId, c.req.param("id")))
    .orderBy(agents.name);
  return c.json(rows);
});

app.patch("/api/agents/:id", async (c) => {
  const body = await c.req.json<{
    harness?: string;
    model?: string;
    waitForReview?: boolean;
    instructions?: string;
  }>();
  const [row] = await db
    .update(agents)
    .set(body)
    .where(eq(agents.id, c.req.param("id")))
    .returning();
  return c.json(row);
});

app.post("/api/projects/:id/agents/sync", async (c) => {
  const n = await syncAgentsForProject(c.req.param("id"));
  return c.json({ synced: n });
});

app.get("/api/projects/:id/sources", async (c) => {
  const rows = await db
    .select()
    .from(sources)
    .where(eq(sources.projectId, c.req.param("id")));
  return c.json(rows);
});

app.post("/api/projects/:id/sources", async (c) => {
  const body = await c.req.json<{
    name: string;
    owner: string;
    repo: string;
    label?: string;
    token: string;
  }>();
  const [sec] = await db
    .insert(secrets)
    .values({
      projectId: c.req.param("id"),
      key: `github:${body.owner}/${body.repo}`,
      ciphertext: encryptSecret(body.token),
    })
    .returning();
  const [source] = await db
    .insert(sources)
    .values({
      projectId: c.req.param("id"),
      kind: "github",
      name: body.name,
      config: {
        owner: body.owner,
        repo: body.repo,
        label: body.label ?? "factory",
      },
      secretId: sec.id,
    })
    .returning();
  return c.json(source, 201);
});

app.get("/api/projects/:id/suggestions", async (c) => {
  const rows = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.projectId, c.req.param("id")))
    .orderBy(desc(suggestions.createdAt));
  return c.json(rows);
});

app.post("/api/projects/:id/secrets", async (c) => {
  const body = await c.req.json<{ key: string; value: string }>();
  const existing = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.projectId, c.req.param("id")), eq(secrets.key, body.key)));
  if (existing[0]) {
    const [row] = await db
      .update(secrets)
      .set({ ciphertext: encryptSecret(body.value) })
      .where(eq(secrets.id, existing[0].id))
      .returning();
    return c.json({ id: row.id, key: row.key });
  }
  const [row] = await db
    .insert(secrets)
    .values({
      projectId: c.req.param("id"),
      key: body.key,
      ciphertext: encryptSecret(body.value),
    })
    .returning();
  return c.json({ id: row.id, key: row.key }, 201);
});

app.get("/api/projects/:id/secrets", async (c) => {
  const rows = await db
    .select({ id: secrets.id, key: secrets.key, createdAt: secrets.createdAt })
    .from(secrets)
    .where(eq(secrets.projectId, c.req.param("id")));
  return c.json(rows);
});

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/web/dist");
app.use("/assets/*", serveStatic({ root: webRoot }));
app.get("/", serveStatic({ root: webRoot, path: "index.html" }));
app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();
  return serveStatic({ root: webRoot, path: "index.html" })(c, next);
});

export function startApi(port = Number(process.env.PORT ?? 3000)) {
  serve({ fetch: app.fetch, port });
  console.log(`api on :${port}`);
}

export { app };
