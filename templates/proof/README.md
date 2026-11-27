# Behavior proof templates

Copy into **factory-config** (or let Factory bootstrap generate them on the product repo).

## Contract

Product repo workflow (default name `factory-proof.yml`) must accept:

| Input | Meaning |
|---|---|
| `sha` | Feature commit to check out |
| `scenario` | What behavior to record |
| `pr_number` | Feature PR number |
| `upload_url` | Factory `POST` endpoint for proof files |
| `upload_token` | Bearer token for that upload |

The job runs `.factory/record-proof.sh`, which must leave reviewable media under `./proof/` and upload to `upload_url`. Stub/1×1 images are rejected — Factory only Inbox-holds when there is reviewable media.

**Adapter, not engine:** Factory never embeds a UI driver. Bootstrap may generate a starter recorder (Playwright only if `package.json`; otherwise an agent stub). Native/iOS/desktop products own `.factory/record-proof.sh` (XCUITest, Maestro, xcodebuild+simulator, desktop automation, agent) — same upload contract. Workflow `runs-on` follows stack hint (`macos-latest` / `windows-latest` / `ubuntu-latest`).

Optional Actions secrets: `ADMIN_PASSWORD` (web sign-in), `CURSOR_API_KEY` / `ANTHROPIC_API_KEY` (agent fallback), `PROOF_BASE_URL` (web preview URL override).

## factory-config verify frontmatter

```yaml
---
description: Record user-visible behavior and attach proof to the PR
agentType: VERIFY
spawnableBy: [foreman]
harness: cursor
verify:
  proof:
    kind: github_workflow
    workflow: factory-proof.yml
---
```

Factory’s engine runs the proof path when the agent name is `verify` (scenario → ensure workflow → dispatch → poll → PR comment → Inbox when reviewable).
