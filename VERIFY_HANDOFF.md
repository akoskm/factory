# Handoff: Factory PR-attached verify

## State (2026-11-27)
- Dogfood product is now **Neo Todo** (`akoskm/neo-todo`), not self-dogfood on factory.
- Factory Dogfood source (`akoskm/factory`) **disabled**.
- Product adapters removed from engine tree: `.factory/*`, product `factory-proof.yml` (deleted, staged).
- Engine keeps `templates/proof/**` + `src/verify/**`.
- Neo-todo bootstrap PR #3 merged: generated Playwright web recorder into neo-todo `.factory/`.

## Architecture (do not regress)
- **Engine is stack-agnostic.** Dispatch product workflow → collect `./proof/` uploads → Inbox/PR hold. No UI driver in engine.
- **Bootstrap adapters only:** `package.json` → Playwright starter; iOS/desktop/unknown → agent stub. Product owns/replaces `.factory/record-proof.sh`.
- `detectStackHint` → `runsOn` + `recorder: web|native`.

## Classification of current factory working tree

### Product cleanup (commit as “stop self-dogfood”)
- `D .factory/proof.json`
- `D .factory/record-proof.sh`
- `D .github/workflows/factory-proof.yml`

### Engine hardenings (separate commit)
- `src/verify/activities.ts` — artifact unzip, real-media accept, reuse fix, setup PR copy, no package.json fallback assume
- `src/verify/workflow-template.ts` + test — `recorder: web|native`, native stub, upload continue-on-error
- `templates/proof/*` — docs + continue-on-error
- `README.md` — stack-agnostic contract

### Notes only
- `VERIFY_HANDOFF.md` (this file)

## Local e2e needs
1. Migration `0008`, Temporal + API + Vite + **worker** (restart worker after `.env` / verify code changes).
2. `FACTORY_PUBLIC_URL` tunnel alive.
3. Per-project `CURSOR_API_KEY` secret (env fallback alone may not be enough if empty `.env` / project override).
4. Product job emits real media ≥~2KB.

## Flow
`planVerifyScenario` → ensure setup PR if missing → human Continue → dispatch proof on feature SHA → poll → upload → Inbox `holdKind: proof` + PR images → approve → ship.

## Known pitfalls
- Dispatch `Not Found` right after merging setup PR — Continue once Actions indexes the workflow.
- Empty encrypted secrets → `invalid ciphertext` (third segment empty).
- Dual Vite ports; dead tunnel (mitigated: continue-on-error + artifact unzip).

## Do not
- Hardcode Playwright into verify engine/activities.
- Treat stub PNGs as success.
- Put product `.factory/record-proof.sh` back into the factory engine repo.
