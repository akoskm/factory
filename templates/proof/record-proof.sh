#!/usr/bin/env bash
set -euo pipefail
# Start the app, drive $SCENARIO (agent or UI test), write media under ./proof/
# SCENARIO, CURSOR_API_KEY, ANTHROPIC_API_KEY come from the workflow.

mkdir -p proof
printf '%s\n' "${SCENARIO:-}" > proof/scenario.txt

if command -v npx >/dev/null 2>&1 && [ -f package.json ]; then
  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; else npm install; fi
  npm run --if-present build || true
  if npm run --if-present preview --dry-run >/dev/null 2>&1; then
    npm run preview >/tmp/factory-preview.log 2>&1 &
    sleep 3
  elif npm run --if-present dev --dry-run >/dev/null 2>&1; then
    npm run dev >/tmp/factory-preview.log 2>&1 &
    sleep 3
  fi
fi

PROMPT="Record the following user-visible behavior. Save screenshots or video under ./proof/ then exit.

$SCENARIO"
if [ -n "${CURSOR_API_KEY:-}" ] && command -v cursor-agent >/dev/null 2>&1; then
  cursor-agent -p --force "$PROMPT" || true
elif [ -n "${ANTHROPIC_API_KEY:-}" ] && command -v claude >/dev/null 2>&1; then
  claude -p "$PROMPT" --allowedTools "Bash,Read,Write" || true
fi

exit 0
