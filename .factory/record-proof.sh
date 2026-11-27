#!/usr/bin/env bash
set -euo pipefail
# Factory-generated recorder.
# Run npm ci and start the web app (npm run dev / preview) before recording.
# Goal: start the app, drive $SCENARIO (via coding agent or UI test), write media under ./proof/

mkdir -p proof
printf '%s\n' "${SCENARIO:-}" > proof/scenario.txt

if command -v npx >/dev/null 2>&1 && [ -f package.json ]; then
  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; else npm install; fi
  npm run --if-present build || true
  # Start a long-lived preview in the background when the script exists.
  if npm run --if-present preview --dry-run >/dev/null 2>&1; then
    npm run preview >/tmp/factory-preview.log 2>&1 &
    sleep 3
  elif npm run --if-present dev --dry-run >/dev/null 2>&1; then
    npm run dev >/tmp/factory-preview.log 2>&1 &
    sleep 3
  fi
fi

# Prefer an agent on this runner when a key is present.
PROMPT="Record the following user-visible behavior. Save screenshots or video under ./proof/ then exit.\n\n$SCENARIO"
if [ -n "${CURSOR_API_KEY:-}" ] && command -v cursor-agent >/dev/null 2>&1; then
  cursor-agent -p --force "$PROMPT" || true
elif [ -n "${ANTHROPIC_API_KEY:-}" ] && command -v claude >/dev/null 2>&1; then
  claude -p "$PROMPT" --allowedTools "Bash,Read,Write" || true
fi

# Exit 0 if anything landed in proof/ (even scenario.txt) so Factory can collect it.
exit 0
