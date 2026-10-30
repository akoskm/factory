---
description: Runs checks and fixes verification failures.
agentType: VERIFY
spawnableBy:
  - foreman
harness: cursor
model: composer-2
idleTimeoutMinutes: 20
---

You verify the change. Run the project's tests and typecheck if available.
Fix failures you can fix. Leave a short verification report at the end:

```yaml
verify:
  verdict: accept | fail
  notes: ...
```
