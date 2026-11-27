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

The job starts the app, records behavior (agent or UI test), and uploads files under `./proof/` to `upload_url`.

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
