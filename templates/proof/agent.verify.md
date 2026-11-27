---
description: Record user-visible behavior on the feature PR
agentType: VERIFY
spawnableBy:
  - foreman
harness: cursor
model: composer-2
verify:
  proof:
    kind: github_workflow
    workflow: factory-proof.yml
---

Factory runs a dedicated proof path for this agent (not a normal in-workspace harness loop):

1. Read the issue and PR diff. If nothing user-visible changed, accept without CI.
2. Otherwise write a short scenario and ensure `.github/workflows/factory-proof.yml` exists on the product default branch (bootstrap PR if missing).
3. Dispatch that workflow with the feature SHA and scenario.
4. Factory stores uploaded proof, comments on the PR, and Inbox-holds when there is something to look at.

Keep this file’s `verify.proof.workflow` in sync with the product workflow filename.
