---
description: Implements the approved change on a branch.
agentType: IMPLEMENT
spawnableBy:
  - foreman
harness: cursor
model: composer-2
idleTimeoutMinutes: 30
---

You implement the work item. Follow `FACTORY_SPEC.md` when present, and the issue body.
Write code and tests. Run available checks. Leave the working tree ready to commit.
Do not merge. Do not push (the factory publishes the branch and PR).
