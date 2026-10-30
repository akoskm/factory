# Spec: List harness models in Agents dropdowns

**Issue:** [akoskm/factory#1](https://github.com/akoskm/factory/issues/1)

## Goal

On the Agents page, replace the free-text model field with a harness-aware `<select>` whose options come from the provider APIs for the project’s stored API keys (server-side). Users see the same model catalog their key can use (e.g. ~48 Cursor models), not a static subset.

## Acceptance criteria

- [ ] **Cursor:** For `harness=cursor`, options come from `Cursor.models.list({ apiKey })` using the project’s `CURSOR_API_KEY` (project secret, else `process.env.CURSOR_API_KEY`).
- [ ] **Claude Code:** For `harness=claude-code`, options come from Anthropic `GET https://api.anthropic.com/v1/models` with the project’s `ANTHROPIC_API_KEY` (secret, else env).
- [ ] **Harness change:** Changing harness refetches models for that harness. If the agent’s stored model is not in the new list, PATCH a valid default model together with the harness change (see defaults below). If the stored model is still in the new list, keep it.
- [ ] **Refresh:** Re-fetching models (page load, harness change) keeps the current selection when its `id` is still in the returned list.
- [ ] **States:** Loading, missing key, empty catalog, and upstream errors are visible in the UI (not a silent empty dropdown). Do not show a permanent hardcoded Cursor pair (`composer-2` / `auto`) except as a **disabled placeholder** while the first fetch is in flight.
- [ ] **Scope:** Agents UI + listing API only. Do not change run-time model wiring beyond what already passes `agent.model` as a string id to harnesses. Do not add `factory` label to runs.

## Technical approach

### 1. Shared API key resolution

Extract `getProjectHarnessApiKey(projectId, harness)` from `src/temporal/activities.ts` into a shared module (e.g. `src/secrets/harness-keys.ts`):

- `claude-code` → `ANTHROPIC_API_KEY`
- `cursor` (default) → `CURSOR_API_KEY`

Lookup: encrypted row in `secrets` for `projectId` + key name, else env fallback. Same behavior as today’s `getAgentApiKey`.

Update `activities.ts` to import the shared helper (no behavior change).

### 2. New API route

Add authenticated route on the Hono app (same auth as other `/api/projects/:id/*` routes):

```
GET /api/projects/:projectId/models?harness=cursor|claude-code
```

**Query validation:** `harness` required; must be `cursor` or `claude-code`. Unknown harness → `400`.

**Response shape:**

```ts
type HarnessModelOption = { id: string; displayName: string };

type ListHarnessModelsResponse = {
  models: HarnessModelOption[];
  error?: string; // human-readable; non-fatal for HTTP (still 200 with empty models when key missing)
};
```

**Behavior:**

| Harness       | Implementation |
|---------------|----------------|
| `cursor`      | `import { Cursor } from "@cursor/sdk"` → `await Cursor.models.list({ apiKey })`. Map each item to `{ id, displayName: item.displayName \|\| item.id }`. |
| `claude-code` | `fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } })`. Parse JSON `data[]`; map to `{ id: model.id, displayName: model.display_name ?? model.id }`. |

**Missing key:** Return `{ models: [], error: "Missing CURSOR_API_KEY" }` or `"Missing ANTHROPIC_API_KEY"` (200). Do not call upstream.

**Upstream failure:** Return `{ models: [], error: "<short message from exception or response body>" }` (200). Log server-side detail if useful.

**Sort:** Client-side or server-side — sort by `displayName` localeCompare, tie-break `id`.

**Not in v1:** Server-side cache, model parameters/variants in payload, exposing raw API keys.

**Design choices (from triage):**

- **Option value:** Always model `id` (matches `cursorHarness` `{ id: input.model }` and claude `--model`).
- **Parameterized models:** List `id` only; do not expose `parameters` / `variants` in the dropdown (harness does not send `params` today).
- **Anthropic without key:** Error state only — no static fallback catalog.

### 3. Agents page UI (`src/web/pages/AgentsPage.tsx`)

Replace the model `<input>` with a `<select>` per agent row.

**Fetching:**

- Introduce a small client cache keyed by `` `${projectId}:${harness}` `` so N agents on the same harness share one in-flight request and result.
- Fetch on mount when agents are loaded (distinct harnesses present on the page).
- Refetch when the user changes harness for that agent (new cache key).

**Select behavior:**

- **Loading:** Disabled select, single option “Loading models…”.
- **Error / missing key:** Disabled select or enabled with only placeholder option showing `error` text (muted helper under select). No fake model list.
- **Success:** One `<option>` per model: label `displayName`, value `id`.
- **Orphan stored model:** If `agent.model` is not in the fetched list but fetch succeeded, add one extra option: value = stored id, label = `` `${agent.model} (not in catalog)` `` so the current DB value remains visible and selected until the user picks a listed model or changes harness. Do not auto-PATCH on page load for orphans (only on harness change per AC).

**Harness change handler (order matters):**

1. Determine target harness from select.
2. Await models for new harness (cache).
3. Let `nextModel = agent.model` if `agent.model` is in the new list; else compute default (below).
4. Single PATCH: `{ harness, ...(nextModel !== agent.model ? { model: nextModel } : {}) }` — if model unchanged, PATCH `{ harness }` only.
5. Reload agents list (existing `load()`).

**Model change:** PATCH `{ model }` on `<select>` change (same as today’s blur-on-input), then optional local state update.

**Default when reset** (stored model ∉ new list after harness change):

1. `cursor`: first match in order — `composer-2`, `auto-smart`, `auto`, then first entry in sorted list.
2. `claude-code`: first match in order — `claude-sonnet-4-20250514`, `claude-3-5-sonnet-20241022`, then first entry in sorted list.

If list is empty (key/error), PATCH harness only; leave model string as-is in DB but UI shows error state for the select (user must fix key in Settings).

### 4. Types

Add `ListHarnessModelsResponse` / client fetch helper in `src/web/api.ts` (or colocate with page if minimal).

### 5. Files (expected touch set)

| Area | Files |
|------|--------|
| Keys | `src/secrets/harness-keys.ts` (new), `src/temporal/activities.ts` |
| API | `src/api/server.ts` (route + list helpers, or `src/api/models.ts`) |
| UI | `src/web/pages/AgentsPage.tsx`, possibly `src/web/hooks/useHarnessModels.ts` |
| Types | `src/web/api.ts` |

No DB schema changes. No agent file / sync changes.

## Out of scope

- Model parameters, variants, or Router `optimize_for` UI.
- Settings “Test connection” or model count display.
- Short-lived or persistent server cache of model lists.
- Free-text model override field.
- New harness types beyond `cursor` and `claude-code`.
- Applying a `factory` label (or other run metadata) when executing agents.
- Workflow / Temporal changes except importing shared key helper.
- Automated test suite (none in repo today).

## Validation plan

1. **Typecheck:** `npm run typecheck` passes.
2. **Manual — Cursor with key:** Settings → save valid `CURSOR_API_KEY`. Agents → each cursor agent’s model select shows many models (ids match API), not two hardcoded entries. Pick a different model → refresh page → selection persists.
3. **Manual — Cursor without key:** Remove key → model select shows missing-key message; no successful catalog.
4. **Manual — Harness switch:** Agent on `composer-2` + cursor → switch to `claude-code` with Anthropic key → model list swaps to Anthropic models; if `composer-2` not in Anthropic list, model resets per default rule and PATCH persists.
5. **Manual — Preserve valid model:** Use a model id that exists for both harnesses (unlikely); if user switches harness and id still in list, model unchanged in DB.
6. **Manual — Orphan:** Set agent model in DB to nonsense via PATCH/API → page load shows “(not in catalog)” option selected; choosing a listed model fixes it.
7. **Manual — Claude Code:** Valid `ANTHROPIC_API_KEY` → dropdown populated from `/v1/models`; run path unchanged (still `claude --model <id>`).
8. **Regression:** Sync agents, toggle wait-for-review, harness PATCH without key errors still work.

**Done when:** All acceptance criteria checked and validation steps 1–7 pass in local dev (`npm run dev`).
