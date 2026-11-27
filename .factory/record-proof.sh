#!/usr/bin/env bash
set -euo pipefail
# Factory product recorder: boot API + Vite, sign in, screenshot the real UI.
# SCENARIO / ADMIN_PASSWORD / CURSOR_API_KEY come from the workflow.

mkdir -p proof
printf '%s\n' "${SCENARIO:-}" > proof/scenario.txt

PROOF_BASE_URL="${PROOF_BASE_URL:-http://127.0.0.1:5173}"
API_PID=""
WEB_PID=""

cleanup() {
  for pid in "$WEB_PID" "$API_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

has_real_media() {
  shopt -s nullglob
  local f size
  for f in proof/*; do
    [ -f "$f" ] || continue
    case "$f" in
      *.png|*.jpg|*.jpeg|*.gif|*.webp|*.mp4|*.webm|*.mov)
        size=$(wc -c < "$f" | tr -d ' ')
        if [ "$size" -ge 2048 ]; then
          return 0
        fi
        ;;
    esac
  done
  return 1
}

export FACTORY_SECRET="${FACTORY_SECRET:-proof-factory-secret}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

echo "Installing deps…"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run db:migrate
npm run build

echo "Starting API on :3000…"
npx tsx -e 'import { startApi } from "./src/api/server.ts"; startApi(3000);' \
  >/tmp/factory-proof-api.log 2>&1 &
API_PID=$!

echo "Starting Vite on :5173…"
npx vite --host 127.0.0.1 --port 5173 >/tmp/factory-proof-web.log 2>&1 &
WEB_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "API failed to start" >&2
  tail -n 80 /tmp/factory-proof-api.log >&2 || true
  exit 1
fi
if ! curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo "Vite failed to start" >&2
  tail -n 80 /tmp/factory-proof-web.log >&2 || true
  exit 1
fi

npm install --no-save --no-package-lock playwright@1.49.1 >/tmp/factory-pw-install.log 2>&1
npx playwright install chromium >/tmp/factory-pw-browser.log 2>&1

PROOF_BASE_URL="$PROOF_BASE_URL" ADMIN_PASSWORD="$ADMIN_PASSWORD" SCENARIO="${SCENARIO:-}" node <<'NODE'
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const base = process.env.PROOF_BASE_URL || "http://127.0.0.1:5173";
  const scenario = process.env.SCENARIO || "";
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password) {
    console.error("ADMIN_PASSWORD is required so proof can sign in and show the sidebar.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });

  await page.locator('input[type="password"]').first().fill(password);
  const signIn = page.getByRole("button", { name: /sign in/i });
  if (await signIn.count()) await signIn.click();
  else await page.keyboard.press("Enter");

  await page.getByText("FACTORY", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.screenshot({ path: "proof/behavior.png", fullPage: false });

  const brand = page.locator("text=FACTORY").first();
  await brand.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: "proof/feature.png", fullPage: false });

  fs.writeFileSync(
    "proof/recorder-notes.txt",
    ["Playwright recorder (factory)", "base: " + base, "signedIn: true", "", scenario, ""].join("\n"),
  );

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
NODE

if ! has_real_media; then
  echo "No real screenshot in proof/" >&2
  ls -la proof >&2 || true
  exit 1
fi

echo "Proof media ready:"
ls -la proof
exit 0
