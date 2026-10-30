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
import { Octokit } from "@octokit/rest";
import { decryptSecret, encryptSecret } from "../crypto/secrets.js";
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
  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  const token = body.token?.trim();
  if (!owner || !repo || !token) {
    return c.json({ error: "owner, repo, and token are required" }, 400);
  }

  const projectId = c.req.param("id");
  const existing = await db.select().from(sources).where(eq(sources.projectId, projectId));
  const dup = existing.find(
    (s) => s.config.owner === owner && s.config.repo === repo,
  );
  if (dup) {
    return c.json(
      { error: `source ${owner}/${repo} already exists — edit it instead` },
      409,
    );
  }

  const secretKey = `github:${owner}/${repo}`;
  const existingSecrets = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.projectId, projectId), eq(secrets.key, secretKey)));
  let secretId: string;
  if (existingSecrets[0]) {
    const [sec] = await db
      .update(secrets)
      .set({ ciphertext: encryptSecret(token) })
      .where(eq(secrets.id, existingSecrets[0].id))
      .returning();
    secretId = sec.id;
  } else {
    const [sec] = await db
      .insert(secrets)
      .values({
        projectId,
        key: secretKey,
        ciphertext: encryptSecret(token),
      })
      .returning();
    secretId = sec.id;
  }

  const [source] = await db
    .insert(sources)
    .values({
      projectId,
      kind: "github",
      name: body.name?.trim() || "GitHub",
      config: {
        owner,
        repo,
        label: body.label?.trim() || "factory",
      },
      secretId,
    })
    .returning();
  return c.json(source, 201);
});

app.patch("/api/sources/:id", async (c) => {
  const body = await c.req.json<{
    name?: string;
    owner?: string;
    repo?: string;
    label?: string;
    token?: string;
    enabled?: boolean;
  }>();
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, c.req.param("id")))
    .limit(1);
  if (!source) return c.json({ error: "not found" }, 404);

  const owner = body.owner?.trim() ?? source.config.owner;
  const repo = body.repo?.trim() ?? source.config.repo;
  const label = body.label?.trim() ?? source.config.label;
  if (!owner || !repo) {
    return c.json({ error: "owner and repo are required" }, 400);
  }

  if (body.token?.trim()) {
    const secretKey = `github:${owner}/${repo}`;
    if (source.secretId) {
      await db
        .update(secrets)
        .set({ ciphertext: encryptSecret(body.token.trim()), key: secretKey })
        .where(eq(secrets.id, source.secretId));
    } else {
      const [sec] = await db
        .insert(secrets)
        .values({
          projectId: source.projectId,
          key: secretKey,
          ciphertext: encryptSecret(body.token.trim()),
        })
        .returning();
      await db.update(sources).set({ secretId: sec.id }).where(eq(sources.id, source.id));
    }
  }

  const [row] = await db
    .update(sources)
    .set({
      name: body.name?.trim() || source.name,
      enabled: body.enabled ?? source.enabled,
      config: { owner, repo, label },
    })
    .where(eq(sources.id, source.id))
    .returning();
  return c.json(row);
});

app.delete("/api/sources/:id", async (c) => {
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, c.req.param("id")))
    .limit(1);
  if (!source) return c.json({ error: "not found" }, 404);
  await db.delete(sources).where(eq(sources.id, source.id));
  if (source.secretId) {
    await db.delete(secrets).where(eq(secrets.id, source.secretId));
  }
  return c.json({ ok: true });
});

app.post("/api/sources/:id/test", async (c) => {
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, c.req.param("id")))
    .limit(1);
  if (!source) return c.json({ error: "not found" }, 404);
  if (!source.secretId) return c.json({ error: "no token stored for this source" }, 400);

  const [sec] = await db.select().from(secrets).where(eq(secrets.id, source.secretId)).limit(1);
  if (!sec) return c.json({ error: "token secret missing" }, 400);

  let token: string;
  try {
    token = decryptSecret(sec.ciphertext);
  } catch {
    return c.json({ error: "could not decrypt token" }, 500);
  }

  const { owner, repo, label } = source.config;
  const octokit = new Octokit({ auth: token });

  try {
    const [{ data: user }, { data: repository }, issues] = await Promise.all([
      octokit.rest.users.getAuthenticated(),
      octokit.rest.repos.get({ owner, repo }),
      octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: "open",
        labels: label,
        per_page: 5,
      }),
    ]);

    return c.json({
      ok: true,
      login: user.login,
      repo: repository.full_name,
      private: repository.private,
      permissions: repository.permissions,
      openLabeledIssues: issues.data.filter((i) => !i.pull_request).length,
      label,
    });
  } catch (err) {
    const message =
      err && typeof err === "object" && "status" in err
        ? `GitHub ${String((err as { status: number }).status)}: ${
            (err as { message?: string }).message ?? "request failed"
          }`
        : err instanceof Error
          ? err.message
          : String(err);
    return c.json({ error: message }, 400);
  }
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
