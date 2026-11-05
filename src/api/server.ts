import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/index.js";
import {
  projects,
  runs,
  secrets,
  sources,
  suggestionRuns,
  suggestions,
  workItemArtifacts,
  workItems,
} from "../db/schema.js";
import { Octokit } from "@octokit/rest";
import { decryptSecret, encryptSecret } from "../crypto/secrets.js";
import { loadFactoryConfigAtSha } from "../config/resolve.js";
import {
  agentConfigFileUrl,
  configEditTarget,
  FACTORY_CONFIG_REPO_KEY,
  githubFileEditUrl,
} from "../config/checkout.js";
import {
  getFactoryConfigSetting,
  setInstanceSetting,
} from "../services/instance-settings.js";
import {
  isHarness,
  listAnthropicModels,
  listCursorModels,
  listLocalModels,
  listHarnessModels,
} from "../services/list-harness-models.js";
import { recoverWorkItem, type RecoverAction } from "../services/recover-work-item.js";
import { runLearnNow } from "../services/run-learn.js";
import { syncOpenSuggestionPulls } from "../suggestions/sync-pr-status.js";
import { signalReview } from "../temporal/client.js";
import { isAuthed, requireAuth, setSessionCookie } from "./auth.js";
import { projectMetrics } from "./metrics.js";
import { redactSecrets } from "../secrets/redact.js";

async function scrubRunSecrets<T extends { id: string; error: string | null; transcript: string }>(
  row: T,
): Promise<T> {
  const error = row.error == null ? null : redactSecrets(row.error);
  const transcript = redactSecrets(row.transcript);
  if (error === row.error && transcript === row.transcript) return row;
  await db.update(runs).set({ error, transcript }).where(eq(runs.id, row.id));
  return { ...row, error, transcript };
}

async function scrubWorkItemError<T extends { id: string; error: string | null }>(
  row: T,
): Promise<T> {
  if (row.error == null) return row;
  const error = redactSecrets(row.error);
  if (error === row.error) return row;
  await db.update(workItems).set({ error }).where(eq(workItems.id, row.id));
  return { ...row, error };
}

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
  return c.json(await Promise.all(rows.map(scrubWorkItemError)));
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
  const artifacts = await db
    .select()
    .from(workItemArtifacts)
    .where(eq(workItemArtifacts.workItemId, item.id))
    .orderBy(workItemArtifacts.kind);
  return c.json({
    ...(await scrubWorkItemError(item)),
    runs: await Promise.all(itemRuns.map(scrubRunSecrets)),
    artifacts,
  });
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

app.post("/api/work-items/:id/recover", async (c) => {
  const body = await c.req.json<{ action?: RecoverAction }>();
  const action = body.action;
  if (
    action !== "retry_last" &&
    action !== "retry_foreman" &&
    action !== "reset_branch"
  ) {
    return c.json({ error: "action must be retry_last | retry_foreman | reset_branch" }, 400);
  }
  try {
    const result = await recoverWorkItem(c.req.param("id"), action);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "not found" ? 404 : 400;
    return c.json({ error: message }, status);
  }
});

app.get("/api/projects/:id/runs", async (c) => {
  const suggestionId = c.req.query("suggestion")?.trim();
  if (suggestionId) {
    const rows = await db
      .select({ run: runs })
      .from(suggestionRuns)
      .innerJoin(runs, eq(runs.id, suggestionRuns.runId))
      .innerJoin(suggestions, eq(suggestions.id, suggestionRuns.suggestionId))
      .where(
        and(
          eq(suggestionRuns.suggestionId, suggestionId),
          eq(suggestions.projectId, c.req.param("id")),
        ),
      )
      .orderBy(desc(runs.startedAt));
    return c.json(await Promise.all(rows.map((row) => scrubRunSecrets(row.run))));
  }
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.projectId, c.req.param("id")))
    .orderBy(desc(runs.startedAt))
    .limit(200);
  return c.json(await Promise.all(rows.map(scrubRunSecrets)));
});

app.get("/api/projects/:id/agents", async (c) => {
  try {
    const { config, sha, repoUrl } = await loadFactoryConfigAtSha({});
    const editTarget = await configEditTarget(repoUrl, sha);
    const editUrl = (file: string) =>
      editTarget ? githubFileEditUrl(editTarget.repoUrl, editTarget.ref, file) : null;
    const learnFile = `agents/${config.pipeline.learnAgent}/agent.md`;
    return c.json({
      configSha: sha,
      configRepo: repoUrl,
      agents: config.agents.map((a) => ({
        name: a.name,
        agentType: a.agentType,
        description: a.description,
        harness: a.harness,
        model: a.model,
        waitForReview: a.waitForReview,
        spawnableBy: a.spawnableBy,
        idleTimeoutMinutes: a.idleTimeoutMinutes,
        instructions: a.instructions,
        editUrl: editUrl(`agents/${a.name}/agent.md`),
      })),
      pipeline: config.pipeline,
      pipelineYaml: await readFile(path.join(config.dir, "pipeline.yaml"), "utf8"),
      pipelineEditUrl: editUrl("pipeline.yaml"),
      learnAgent: config.pipeline.learnAgent,
      learnAgentFileUrl:
        editUrl(learnFile) ?? agentConfigFileUrl(repoUrl, sha, config.pipeline.learnAgent),
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

app.get("/api/settings/factory-config", async (c) => {
  return c.json(await getFactoryConfigSetting());
});

app.patch("/api/settings/factory-config", async (c) => {
  const body = await c.req.json<{ repoUrl?: string }>();
  const repoUrl = body.repoUrl?.trim();
  if (!repoUrl) {
    return c.json({ error: "repoUrl is required" }, 400);
  }
  await setInstanceSetting(FACTORY_CONFIG_REPO_KEY, repoUrl);
  // Validate by loading HEAD
  try {
    const loaded = await loadFactoryConfigAtSha({});
    return c.json({
      repoUrl: loaded.repoUrl,
      source: "settings" as const,
      configSha: loaded.sha,
      agentCount: loaded.config.agents.length,
    });
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : String(err),
        repoUrl,
        source: "settings" as const,
      },
      400,
    );
  }
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
  const selected = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.projectId, c.req.param("id")))
    .orderBy(desc(suggestions.updatedAt));
  const rows = await syncOpenSuggestionPulls(c.req.param("id"), selected);
  const ids = rows.map((row) => row.id);
  const links = ids.length
    ? await db
        .select()
        .from(suggestionRuns)
        .where(inArray(suggestionRuns.suggestionId, ids))
    : [];
  const runCount = new Map<string, number>();
  for (const link of links) {
    runCount.set(link.suggestionId, (runCount.get(link.suggestionId) ?? 0) + 1);
  }
  return c.json(rows.map((row) => ({ ...row, runCount: runCount.get(row.id) ?? 0 })));
});

app.post("/api/projects/:id/learn", async (c) => {
  try {
    return c.json(await runLearnNow(c.req.param("id")));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "not found" ? 404 : message.startsWith("work item") ? 409 : 400;
    return c.json({ error: message }, status);
  }
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

app.get("/api/projects/:id/models", async (c) => {
  const harness = c.req.query("harness")?.trim() ?? "";
  if (!isHarness(harness)) {
    return c.json({ error: "harness must be cursor or claude-code" }, 400);
  }
  const projectId = c.req.param("id");
  try {
    const result = await listHarnessModels(projectId, harness);
    if (result.error) {
      return c.json({ harness, models: result.models, error: result.error }, 200);
    }
    return c.json({ harness, models: result.models });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

app.post("/api/projects/:id/secrets/test", async (c) => {
  const body = await c.req.json<{ key: string }>();
  const key = body.key?.trim();
  if (key !== "CURSOR_API_KEY" && key !== "ANTHROPIC_API_KEY" && key !== "LOCAL_API_KEY") {
    return c.json({ error: "key must be CURSOR_API_KEY, ANTHROPIC_API_KEY, or LOCAL_API_KEY" }, 400);
  }

  const projectId = c.req.param("id");
  const rows = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.projectId, projectId), eq(secrets.key, key)));
  const row = rows[0];
  if (!row) return c.json({ error: `${key} is not set for this project` }, 400);

  let token: string;
  try {
    token = decryptSecret(row.ciphertext);
  } catch {
    return c.json({ error: "could not decrypt stored key" }, 500);
  }
  if (!token.trim()) return c.json({ error: `${key} is empty` }, 400);

  try {
    if (key === "CURSOR_API_KEY") {
      const { Cursor } = await import("@cursor/sdk");
      const me = await Cursor.me({ apiKey: token });
      const models = await listCursorModels(token);
      const name = [me.userFirstName, me.userLastName].filter(Boolean).join(" ");
      const login = me.userEmail || name || me.apiKeyName || "authenticated";
      return c.json({
        ok: true,
        provider: "cursor",
        login,
        modelCount: models.length,
      });
    }

    if (key === "LOCAL_API_KEY") {
      const models = await listLocalModels(
        token,
        process.env.LOCAL_API_BASE_URL ?? "http://127.0.0.1:18434/v1",
      );
      return c.json({
        ok: true,
        provider: "local",
        login: "connected",
        modelCount: models.length,
      });
    }

    const models = await listAnthropicModels(token);
    return c.json({
      ok: true,
      provider: "anthropic",
      login: "authenticated",
      modelCount: models.length,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
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
