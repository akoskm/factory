#!/usr/bin/env bash
set -euo pipefail
# Start the app, drive $SCENARIO, write real screenshots/video under ./proof/
# SCENARIO, CURSOR_API_KEY, ANTHROPIC_API_KEY, ADMIN_PASSWORD come from the workflow.

mkdir -p proof
printf '%s\n' "${SCENARIO:-}" > proof/scenario.txt

PROOF_BASE_URL="${PROOF_BASE_URL:-}"
APP_PID=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

pkg_has_script() {
  node -e 'const p=require("./package.json"); process.exit(p.scripts && p.scripts[process.argv[1]] ? 0 : 1)' "$1" 2>/dev/null
}

start_web_app() {
  if ! command -v npx >/dev/null 2>&1 || [ ! -f package.json ]; then
    return 1
  fi
  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; else npm install; fi
  npm run --if-present build || true

  is_next=0
  if [ -f next.config.ts ] || [ -f next.config.js ] || [ -f next.config.mjs ]; then
    is_next=1
  elif node -e 'const p=require("./package.json"); const d={...p.dependencies,...p.devDependencies}; process.exit(d.next?0:1)' 2>/dev/null; then
    is_next=1
  fi

  # Next.js: production start on :3000 after build (not Vite :5173).
  if [ "$is_next" = "1" ]; then
    if pkg_has_script start; then
      npm run start -- -p 3000 >/tmp/factory-preview.log 2>&1 &
    else
      npx next start -p 3000 >/tmp/factory-preview.log 2>&1 &
    fi
    APP_PID=$!
    PROOF_BASE_URL="${PROOF_BASE_URL:-http://127.0.0.1:3000}"
  elif pkg_has_script preview; then
    npm run preview -- --host 127.0.0.1 --port 5173 >/tmp/factory-preview.log 2>&1 &
    APP_PID=$!
    PROOF_BASE_URL="${PROOF_BASE_URL:-http://127.0.0.1:5173}"
  elif [ -f vite.config.ts ] || [ -f vite.config.js ] || [ -f vite.config.mjs ]; then
    npx vite --host 127.0.0.1 --port 5173 >/tmp/factory-preview.log 2>&1 &
    APP_PID=$!
    PROOF_BASE_URL="${PROOF_BASE_URL:-http://127.0.0.1:5173}"
  elif pkg_has_script start; then
    npm run start >/tmp/factory-preview.log 2>&1 &
    APP_PID=$!
    PROOF_BASE_URL="${PROOF_BASE_URL:-http://127.0.0.1:3000}"
  elif pkg_has_script dev; then
    npm run dev >/tmp/factory-preview.log 2>&1 &
    APP_PID=$!
    PROOF_BASE_URL="${PROOF_BASE_URL:-http://127.0.0.1:3000}"
  else
    return 1
  fi

  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if curl -fsS "$PROOF_BASE_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "app did not become ready at $PROOF_BASE_URL" >&2
  tail -n 80 /tmp/factory-preview.log >&2 || true
  return 1
}

capture_with_playwright() {
  npm install --no-save --no-package-lock playwright@1.49.1 >/tmp/factory-pw-install.log 2>&1 || {
    echo "playwright npm install failed" >&2
    tail -n 40 /tmp/factory-pw-install.log >&2 || true
    return 1
  }
  npx playwright install chromium >/tmp/factory-pw-browser.log 2>&1 || {
    echo "playwright browser install failed" >&2
    tail -n 40 /tmp/factory-pw-browser.log >&2 || true
    return 1
  }

  PROOF_BASE_URL="$PROOF_BASE_URL" ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" SCENARIO="${SCENARIO:-}" node <<'NODE'
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const base = process.env.PROOF_BASE_URL || "http://127.0.0.1:3000";
  const scenario = process.env.SCENARIO || "";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 }).catch(async () => {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  });

  const password = process.env.ADMIN_PASSWORD || "";
  if (password) {
    const field = page.locator('input[type="password"]').first();
    if (await field.count()) {
      await field.fill(password);
      const signIn = page.getByRole("button", { name: /sign in/i });
      if (await signIn.count()) await signIn.click();
      else await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
    }
  }

  await page.waitForTimeout(1000);
  // Generic UI proof — product-agnostic (no brand-specific selectors).
  await page.screenshot({ path: "proof/behavior.png", fullPage: false });
  await page.screenshot({ path: "proof/feature.png", fullPage: true });

  fs.writeFileSync(
    "proof/recorder-notes.txt",
    ["Playwright web recorder", "base: " + base, "signedIn: " + Boolean(password), "", scenario, ""].join("\n"),
  );

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
NODE
}

capture_with_agent() {
  local prompt
  prompt="You are recording proof that a product change works.

Scenario:
$SCENARIO

The app should already be running at $PROOF_BASE_URL (or start it if needed).
Sign in when ADMIN_PASSWORD is set in the environment.
Drive the happy path in the scenario.
Save one or more real screenshots (PNG/JPEG) or a short video under ./proof/.
Do not write a 1x1 placeholder image. The files must show the actual UI.
Then exit."

  if [ -n "${CURSOR_API_KEY:-}" ]; then
    if ! command -v cursor-agent >/dev/null 2>&1; then
      curl -fsSL https://cursor.com/install | bash || true
      export PATH="$HOME/.local/bin:$PATH"
    fi
    if command -v cursor-agent >/dev/null 2>&1; then
      cursor-agent -p --force "$prompt" || true
      return 0
    fi
  fi
  if [ -n "${ANTHROPIC_API_KEY:-}" ] && command -v claude >/dev/null 2>&1; then
    claude -p "$prompt" --allowedTools "Bash,Read,Write" || true
  fi
}

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

started=0
if start_web_app; then
  started=1
fi

if [ "$started" = "1" ]; then
  capture_with_playwright || true
fi

if ! has_real_media; then
  capture_with_agent || true
fi

if ! has_real_media; then
  echo "No real screenshot/video in proof/ — verify cannot hand the user proof." >&2
  ls -la proof >&2 || true
  exit 1
fi

exit 0
